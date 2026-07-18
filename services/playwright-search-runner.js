const path = require("path");
const { spawn } = require("child_process");
const { createUserSupabaseClient } = require("./supabase-server");
const { cacheCompletedWorkflow } = require("../utils/WorkflowProgress");

const activeExecutions = new Map();
const PERSISTENCE_POLL_INTERVAL_MS = 2000;
const PERSISTENCE_TIMEOUT_MS = 120000;

function logExecution(event, payload, details = {}) {
    console.log("Target search execution", {
        event,
        workflow_run_id: payload.workflow_run_id,
        search_request_id: payload.search_request_id,
        owner_user_id: payload.owner_user_id,
        ...details
    });
}

function requiredEnvironment() {
    const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY"].filter(name => !process.env[name]);
    if (missing.length) throw new Error(`Missing required server environment: ${missing.join(", ")}`);
}

async function updateProgress(supabase, ownerUserId, workflowRunId, values) {
    const { error } = await supabase.from("workflow_runs").update(values)
        .eq("id", workflowRunId).eq("owner_user_id", ownerUserId);
    if (error) throw error;
}

async function markExecutionFailed({ supabase, ownerUserId, workflowRunId, searchRequestId, error }) {
    const failedAt = new Date().toISOString();
    const message = String(error?.message || "Workflow execution failed.").slice(0, 500);
    const [workflowResult, searchResult] = await Promise.all([
        supabase.from("workflow_runs").update({
            status: "failed", failed_at: failedAt, current_step: "failed",
            current_message: "Search failed.", estimated_remaining_seconds: null
        }).eq("id", workflowRunId).eq("owner_user_id", ownerUserId),
        supabase.from("search_requests").update({
            status: "failed", failed_at: failedAt, error_message: message
        }).eq("id", searchRequestId).eq("owner_user_id", ownerUserId).eq("workflow_run_id", workflowRunId)
    ]);
    if (workflowResult.error || searchResult.error) throw workflowResult.error || searchResult.error;
}

function childCompletion(child) {
    return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error(`Playwright workflow exited with code ${code}.`)));
    });
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function readPersistenceState(supabase, payload) {
    const [workflow, search, candidates] = await Promise.all([
        supabase.from("workflow_runs").select("status").eq("id", payload.workflow_run_id)
            .eq("owner_user_id", payload.owner_user_id).maybeSingle(),
        supabase.from("search_requests").select("status").eq("id", payload.search_request_id)
            .eq("workflow_run_id", payload.workflow_run_id).eq("owner_user_id", payload.owner_user_id).maybeSingle(),
        supabase.from("ranked_candidates").select("id", { count: "exact", head: true })
            .eq("workflow_run_id", payload.workflow_run_id).eq("owner_user_id", payload.owner_user_id)
    ]);
    const error = workflow.error || search.error || candidates.error;
    if (error) throw error;
    return {
        workflowStatus: workflow.data?.status || null,
        searchStatus: search.data?.status || null,
        candidateCount: candidates.count || 0
    };
}

async function markExecutionCompleted(supabase, payload) {
    const completedAt = new Date().toISOString();
    const [workflow, search] = await Promise.all([
        supabase.from("workflow_runs").update({
            status: "completed", completed_at: completedAt, current_step: "refreshing_cache",
            current_message: "Refreshing cache...", progress_percent: 99,
            estimated_remaining_seconds: 5
        }).eq("id", payload.workflow_run_id).eq("owner_user_id", payload.owner_user_id),
        supabase.from("search_requests").update({ status: "completed", completed_at: completedAt })
            .eq("id", payload.search_request_id).eq("workflow_run_id", payload.workflow_run_id)
            .eq("owner_user_id", payload.owner_user_id)
    ]);
    if (workflow.error || search.error) throw workflow.error || search.error;
}

async function finalizeExecutionCompleted(supabase, payload) {
    await updateProgress(supabase, payload.owner_user_id, payload.workflow_run_id, {
        current_step: "completed", current_message: "Search completed successfully.",
        progress_percent: 100, estimated_remaining_seconds: 0
    });
}

async function waitForPersistedResults({
    supabase,
    payload,
    pollIntervalMs = PERSISTENCE_POLL_INTERVAL_MS,
    timeoutMs = PERSISTENCE_TIMEOUT_MS,
    readState = readPersistenceState,
    markCompleted = markExecutionCompleted,
    sleep = delay,
    now = Date.now
}) {
    const deadline = now() + timeoutMs;
    let completionRequested = false;
    let previousState = "";

    while (now() < deadline) {
        const state = await readState(supabase, payload);
        const stateKey = `${state.workflowStatus}:${state.searchStatus}:${state.candidateCount}`;
        if (stateKey !== previousState) {
            logExecution("persistence_state", payload, {
                workflow_status: state.workflowStatus,
                search_status: state.searchStatus,
                candidate_count: state.candidateCount
            });
            previousState = stateKey;
        }
        if ([state.workflowStatus, state.searchStatus].some(status => ["failed", "cancelled"].includes(status))) {
            throw new Error(`Workflow entered terminal state while waiting for persisted candidates: ${state.workflowStatus || state.searchStatus}.`);
        }
        if (state.candidateCount > 0 && state.workflowStatus === "completed" && state.searchStatus === "completed") {
            return state;
        }
        if (state.candidateCount > 0 && !completionRequested) {
            await markCompleted(supabase, payload);
            completionRequested = true;
            continue;
        }
        await sleep(pollIntervalMs);
    }

    throw new Error("Timed out waiting for analyzed candidates to be persisted.");
}

function startTargetSearchExecution(payload, accessToken, dependencies = {}) {
    const workflowRunId = payload.workflow_run_id;
    if (activeExecutions.has(workflowRunId)) {
        return { started: false, alreadyExecuting: true, promise: activeExecutions.get(workflowRunId) };
    }

    const spawnProcess = dependencies.spawn || spawn;
    const createClient = dependencies.createUserSupabaseClient || createUserSupabaseClient;

    const execution = (async () => {
        await Promise.resolve();
        let supabase = null;
        const startedAt = Date.now();
        try {
            logExecution("started", payload);
            supabase = createClient(accessToken);
            requiredEnvironment();
            await updateProgress(supabase, payload.owner_user_id, workflowRunId, {
                current_step: "starting", current_message: "Launching Playwright...",
                progress_percent: 10, estimated_remaining_seconds: 20
            });

            const runDirectory = path.join(__dirname, "..", "data", "runs", workflowRunId);
            const target = {
                name: payload.target.target_name, company: payload.target.current_company,
                linkedin_name: payload.target.linkedin_name, location: payload.target.location,
                ...payload.filters
            };
            const child = spawnProcess(process.execPath, [path.join(__dirname, "..", "index.js")], {
                cwd: path.join(__dirname, ".."), windowsHide: true, stdio: ["ignore", "inherit", "inherit"],
                env: {
                    ...process.env, OWNER_USER_ID: payload.owner_user_id, WORKFLOW_RUN_ID: workflowRunId,
                    SEARCH_REQUEST_ID: payload.search_request_id, SEARCH_HASH: payload.normalized_search_key,
                    SUPABASE_ACCESS_TOKEN: accessToken, WARM_PATH_RUN_DIR: runDirectory,
                    WARM_PATH_TARGET_JSON: JSON.stringify(target), PLAYWRIGHT_HEADLESS: "true"
                }
            });
            logExecution("playwright_spawned", payload);
            await childCompletion(child);
            logExecution("playwright_completed", payload, { elapsed_ms: Date.now() - startedAt });
            await (dependencies.waitForPersistedResults || waitForPersistedResults)({ supabase, payload });
            logExecution("results_persisted", payload, { elapsed_ms: Date.now() - startedAt });
            await (dependencies.cacheCompletedWorkflow || cacheCompletedWorkflow)({
                client: supabase,
                workflowId: workflowRunId,
                ownerUserId: payload.owner_user_id,
                searchHash: payload.normalized_search_key
            });
            logExecution("cache_refreshed", payload, { elapsed_ms: Date.now() - startedAt });
            await (dependencies.finalizeExecutionCompleted || finalizeExecutionCompleted)(supabase, payload);
            logExecution("completed", payload, { elapsed_ms: Date.now() - startedAt });
        } catch (error) {
            console.error("Target search execution failed", {
                owner_user_id: payload.owner_user_id, workflow_run_id: workflowRunId,
                search_request_id: payload.search_request_id, error: error?.stack || error?.message
            });
            if (supabase) {
                await markExecutionFailed({
                    supabase, ownerUserId: payload.owner_user_id, workflowRunId,
                    searchRequestId: payload.search_request_id, error
                }).catch(failureError => console.error("Failed to persist workflow failure", {
                    workflow_run_id: workflowRunId, code: failureError.code || "unknown"
                }));
            }
        } finally {
            activeExecutions.delete(workflowRunId);
            logExecution("registry_cleared", payload, { elapsed_ms: Date.now() - startedAt });
        }
    })();

    activeExecutions.set(workflowRunId, execution);
    return { started: true, alreadyExecuting: false, promise: execution };
}

module.exports = {
    activeExecutions,
    childCompletion,
    finalizeExecutionCompleted,
    markExecutionFailed,
    startTargetSearchExecution,
    waitForPersistedResults
};
