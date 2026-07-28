const path = require("path");
const { spawn } = require("child_process");
const { createServiceSupabaseClient } = require("./supabase-server");
const { readFinalExtractionResult } = require("./final-extraction-result");
const { dispatchCompletedExtraction } = require("./n8n-dispatch-service");
const { buildFinalExtractionResult } = require("./final-extraction-result");
const { findValidSharedSearchCache, upsertSharedSearchCache } = require("./search-cache");
const { resolvePlaywrightHeadless } = require("./browser");

const activeExecutions = new Map();
const activeExecutionContexts = new Map();
const activeWorkflowProcesses = new Map();
const PERSISTENCE_POLL_INTERVAL_MS = 2000;
const PERSISTENCE_TIMEOUT_MS = 120000;
const PROGRESS_PREFIX = "__WARM_PATH_PROGRESS__=";
const RESULT_FILE_PREFIX = "__WARM_PATH_RESULT_FILE__=";
const ERROR_PREFIX = "__WARM_PATH_ERROR__=";
const ALLOWED_PROGRESS = new Map([
    ["starting_search", 10], ["linkedin_session_verified", 15], ["human_browsing", 25],
    ["searching_target", 35], ["target_profile_opened", 45], ["extracting_target", 55],
    ["opening_connections", 62], ["collecting_connections", 72], ["building_candidates", 82],
    ["extraction_completed", 88]
]);

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

async function updateProgress(supabase, ownerUserId, workflowRunId, values, activeOnly = false) {
    let query = supabase.from("workflow_runs").update(values)
        .eq("id", workflowRunId).eq("owner_user_id", ownerUserId);
    if (activeOnly) query = query.in("status", ["queued", "running", "starting", "processing", "in_progress"]);
    const { error } = await query;
    if (error) throw error;
}

async function markExecutionFailed({ supabase, ownerUserId, workflowRunId, searchRequestId, error }) {
    const failedAt = new Date().toISOString();
    const message = publicSearchErrorMessage(error);
    if (typeof supabase.rpc === "function") {
        const transaction = await supabase.rpc("fail_target_search_pair", {
            p_workflow_run_id: workflowRunId,
            p_search_request_id: searchRequestId,
            p_error_message: message
        });
        if (!transaction.error) return;
        if (!/PGRST202|42883/.test(transaction.error.code || "")) throw transaction.error;
        console.warn("Transactional failure RPC is unavailable; using backward-compatible paired updates.", {
            workflow_run_id: workflowRunId,
            code: transaction.error.code
        });
    }
    const updateWorkflow = values => supabase.from("workflow_runs").update(values)
        .eq("id", workflowRunId).eq("owner_user_id", ownerUserId)
        .in("status", ["queued", "running", "starting", "processing", "in_progress"]);
    const updateSearch = values => supabase.from("search_requests").update(values)
        .eq("id", searchRequestId).eq("owner_user_id", ownerUserId)
        .eq("workflow_run_id", workflowRunId)
        .in("status", ["queued", "running", "starting", "processing", "in_progress"]);
    let [workflowResult, searchResult] = await Promise.all([
        updateWorkflow({
            status: "failed", failed_at: failedAt, current_step: "failed",
            current_message: "Search failed.", estimated_remaining_seconds: null
        }),
        updateSearch({
            status: "failed", failed_at: failedAt, error_message: message
        })
    ]);
    if (workflowResult.error?.code === "PGRST204") {
        console.warn("Workflow failure columns are unavailable; retrying status-only update.", {
            workflow_run_id: workflowRunId
        });
        workflowResult = await updateWorkflow({ status: "failed" });
    }
    if (searchResult.error?.code === "PGRST204") {
        console.warn("Search failure columns are unavailable; retrying status-only update.", {
            search_request_id: searchRequestId
        });
        searchResult = await updateSearch({ status: "failed" });
    }
    if (workflowResult.error || searchResult.error) throw workflowResult.error || searchResult.error;
}

async function failActiveExecutions(reason = "Search interrupted because the backend was stopped.") {
    const contexts = [...activeExecutionContexts.values()];
    await Promise.all(contexts.map(async context => {
        context.shutdownReason = reason;
        await terminateWorkflowProcess(context.payload.workflow_run_id, { reason }).catch(error => {
            console.error("[Recovery] Active process termination failed.", {
                workflow_run_id: context.payload.workflow_run_id,
                reason: error.message
            });
        });
        try {
            const supabase = context.supabase || context.createClient(context.accessToken);
            await markExecutionFailed({
                supabase,
                ownerUserId: context.payload.owner_user_id,
                workflowRunId: context.payload.workflow_run_id,
                searchRequestId: context.payload.search_request_id,
                error: new Error(reason)
            });
            console.log("[Recovery] Active search marked as FAILED during shutdown.", {
                search_id: context.payload.search_request_id
            });
        } catch (error) {
            console.error("[Recovery] Failed to persist active search shutdown.", {
                search_id: context.payload.search_request_id,
                reason: error.message,
                code: error.code || "unknown"
            });
        }
    }));
}

function childCompletion(child) {
    return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error(`Playwright workflow exited with code ${code}.`)));
    });
}

function shouldReuseSearchCache(environment = process.env) {
    if (environment.PLAYWRIGHT_REUSE_SEARCH_CACHE !== undefined) {
        return String(environment.PLAYWRIGHT_REUSE_SEARCH_CACHE)
            .trim()
            .toLowerCase() === "true";
    }
    return environment.NODE_ENV === "production";
}

function getExecutionState(workflowRunId) {
    if (activeExecutions.has(workflowRunId)) {
        return { active: true, duplicate: true, busy: false };
    }
    return {
        active: activeExecutions.size > 0,
        duplicate: false,
        busy: activeExecutions.size > 0
    };
}

function publicSearchErrorMessage(error) {
    const message = String(error?.message || "The search could not be completed. Please try again.");
    if (/playwright|chromium|chrome executable|browser startup|[A-Z]:\\|\/(?:users|home|tmp)\//i.test(message)) {
        return "The search could not be completed. Please try again.";
    }
    return message.slice(0, 500);
}

async function markSearchCacheDecision(supabase, request, cacheHit) {
    const { error } = await supabase.from("search_requests").update({ cache_hit: cacheHit })
        .eq("id", request.search_request_id)
        .eq("workflow_run_id", request.workflow_run_id)
        .eq("owner_user_id", request.owner_user_id)
        .in("status", ["queued", "running", "starting", "processing", "in_progress"]);
    if (error) throw error;
}

function attachProgressReader(child, supabase, payload) {
    if (!child.stdout) return {
        completed: () => Promise.resolve(), resultFile: () => null, childError: () => null
    };
    let buffer = "";
    let emittedResultFile = null;
    let emittedChildError = null;
    let writes = Promise.resolve();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
        process.stdout.write(chunk);
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
            if (line.startsWith(RESULT_FILE_PREFIX)) {
                emittedResultFile = line.slice(RESULT_FILE_PREFIX.length).trim();
                continue;
            }
            if (line.startsWith(ERROR_PREFIX)) {
                try {
                    const parsed = JSON.parse(line.slice(ERROR_PREFIX.length));
                    if (typeof parsed?.message === "string") {
                        emittedChildError = {
                            code: String(parsed.code || "PLAYWRIGHT_PIPELINE_FAILED").slice(0, 80),
                            message: parsed.message.slice(0, 500)
                        };
                    }
                } catch {
                    emittedChildError = null;
                }
                continue;
            }
            if (!line.startsWith(PROGRESS_PREFIX)) continue;
            writes = writes.then(async () => {
                const event = JSON.parse(line.slice(PROGRESS_PREFIX.length));
                if (ALLOWED_PROGRESS.get(event.stage) !== event.percent || typeof event.message !== "string") {
                    throw new Error("Playwright emitted an invalid progress event.");
                }
                const values = {
                    status: "running", current_step: event.stage, current_message: event.message,
                    progress_percent: event.percent, estimated_remaining_seconds: null,
                    updated_at: new Date().toISOString()
                };
                if (Number.isInteger(event.candidate_count)) values.total_candidates = Math.max(0, event.candidate_count);
                if (Number.isInteger(event.connection_count)) values.mutual_connections = Math.max(0, event.connection_count);
                if (Number.isInteger(event.profiles_processed)) values.profiles_processed = Math.max(0, event.profiles_processed);
                await updateProgress(supabase, payload.owner_user_id, payload.workflow_run_id, values, true);
                logExecution("progress", payload, { stage: event.stage, percent: event.percent });
            });
        }
    });
    child.stderr?.on("data", chunk => process.stderr.write(chunk));
    return {
        completed: () => writes,
        resultFile: () => emittedResultFile,
        childError: () => emittedChildError
    };
}

function waitForChildExit(child, timeoutMs) {
    if (!child || child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve(true);
    return new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        child.once("close", () => finish(true));
        child.once("exit", () => finish(true));
    });
}

async function forceKillProcessTree(child, dependencies = {}) {
    if (!child?.pid) return;
    const platform = dependencies.platform || process.platform;
    if (platform === "win32") {
        const spawnProcess = dependencies.spawn || spawn;
        await new Promise(resolve => {
            const killer = spawnProcess("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
                windowsHide: true, stdio: "ignore"
            });
            killer.once("error", resolve);
            killer.once("close", resolve);
        });
        return;
    }
    try { process.kill(child.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
    }
}

async function terminateWorkflowProcess(workflowRunId, options = {}) {
    const child = activeWorkflowProcesses.get(workflowRunId);
    const context = activeExecutionContexts.get(workflowRunId);
    if (context) context.shutdownReason = options.reason || "Workflow stopped by user.";
    if (!child) return { found: false, forced: false };

    console.log("Target search execution", { event: "stop_sigterm", workflow_run_id: workflowRunId });
    if (!child.killed) child.kill("SIGTERM");
    const exited = await waitForChildExit(child, options.graceMs || 3000);
    if (!exited) {
        console.warn("Target search execution", {
            event: "stop_force_kill", workflow_run_id: workflowRunId,
            reason: "Child did not exit after SIGTERM."
        });
        await forceKillProcessTree(child, options);
        await waitForChildExit(child, options.forceWaitMs || 2000);
    }
    activeWorkflowProcesses.delete(workflowRunId);
    return { found: true, forced: !exited };
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
            status: "processing",
            current_step: "refreshing_cache",
            current_message: "Refreshing cache...", progress_percent: 99,
            estimated_remaining_seconds: 5
        }).eq("id", payload.workflow_run_id).eq("owner_user_id", payload.owner_user_id)
            .in("status", ["queued", "running", "starting", "processing", "in_progress"]),
        supabase.from("search_requests").update({
            status: "completed", completed_at: completedAt, finished_at: completedAt
        })
            .eq("id", payload.search_request_id).eq("workflow_run_id", payload.workflow_run_id)
            .eq("owner_user_id", payload.owner_user_id)
            .in("status", ["queued", "running", "starting", "processing", "in_progress"])
    ]);
    if (workflow.error || search.error) throw workflow.error || search.error;
}

async function finalizeExecutionCompleted(supabase, payload) {
    const completedAt = new Date().toISOString();
    await updateProgress(supabase, payload.owner_user_id, payload.workflow_run_id, {
        status: "completed", completed_at: completedAt, finished_at: completedAt,
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
        if (state.candidateCount > 0 &&
            ["processing", "completed"].includes(state.workflowStatus) &&
            state.searchStatus === "completed") {
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
    const createClient = dependencies.createServiceSupabaseClient ||
        dependencies.createUserSupabaseClient || createServiceSupabaseClient;
    const executionContext = { payload, accessToken, createClient, supabase: null, child: null, shutdownReason: null };
    activeExecutionContexts.set(workflowRunId, executionContext);

    const execution = (async () => {
        await Promise.resolve();
        let supabase = null;
        const startedAt = Date.now();
        try {
            if (executionContext.shutdownReason) throw new Error(executionContext.shutdownReason);
            supabase = createClient(accessToken);
            executionContext.supabase = supabase;
            requiredEnvironment();
            const { validateTargetSearchRequest } = await import("../types/target-search-request.ts");
            const request = validateTargetSearchRequest(payload);
            executionContext.payload = request;
            console.log("========== NEW SEARCH ==========");
            console.log(`Workflow ID: ${workflowRunId}`);
            console.log(`Search ID: ${request.search_request_id}`);
            logExecution("started", request);
            console.log("[LOCAL_WORKER_JOB_START]", {
                workflow_run_id: workflowRunId,
                search_request_id: request.search_request_id,
                started_at: new Date().toISOString()
            });
            console.log("[WORKFLOW_OWNER_RESOLVED]", {
                owner_user_id: request.owner_user_id, workflow_run_id: workflowRunId,
                search_request_id: request.search_request_id
            });
            logExecution("search_cache_lookup_started", request, {
                normalized_search_key_prefix: (request.normalized_search_key || "").slice(0, 12)
            });
            const environment = dependencies.environment || process.env;
            const reuseSearchCache = shouldReuseSearchCache(environment);
            const cacheDecision = reuseSearchCache
                ? await (dependencies.findValidSharedSearchCache || findValidSharedSearchCache)(
                    supabase,
                    request.normalized_search_key
                )
                : { hit: false, invalid: false, row: null, profiles: [] };
            if (!reuseSearchCache) {
                logExecution("search_cache_bypassed", request, {
                    reason: "local_fresh_browser_execution"
                });
            }
            const cacheContainsDetailedCandidates = cacheDecision.hit &&
                cacheDecision.profiles.every(profile =>
                    profile && typeof profile === "object" &&
                    Array.isArray(profile.experience) &&
                    Array.isArray(profile.education) &&
                    Array.isArray(profile.skills) &&
                    Array.isArray(profile.technologies) &&
                    (profile.relationship_evidence === null ||
                        profile.relationship_evidence && typeof profile.relationship_evidence === "object")
                );
            if (cacheContainsDetailedCandidates) {
                logExecution("search_cache_hit", request, {
                    cache_id: cacheDecision.row.id,
                    profile_count: cacheDecision.profiles.length
                });
                await markSearchCacheDecision(supabase, request, true);
                await updateProgress(supabase, request.owner_user_id, workflowRunId, {
                    status: "processing", cache_hit: true,
                    current_step: "dispatching_to_n8n",
                    current_message: "Processing cached profiles...",
                    progress_percent: 90, estimated_remaining_seconds: null
                }, true);
                const cachedResult = buildFinalExtractionResult({
                    ownerUserId: request.owner_user_id,
                    workflowRunId,
                    searchRequestId: request.search_request_id,
                    target: request.target,
                    connections: [...cacheDecision.profiles],
                    candidates: [...cacheDecision.profiles]
                });
                logExecution("cached_profiles_forward_started", request, {
                    cache_id: cacheDecision.row.id,
                    profile_count: cacheDecision.profiles.length
                });
                await (dependencies.dispatchCompletedExtraction || dispatchCompletedExtraction)({
                    supabase,
                    result: cachedResult,
                    searchHash: request.normalized_search_key,
                    cacheHit: true,
                    cacheId: cacheDecision.row.id
                });
                logExecution("cached_profiles_forward_completed", request, {
                    cache_id: cacheDecision.row.id,
                    profile_count: cacheDecision.profiles.length
                });
                await (dependencies.waitForPersistedResults || waitForPersistedResults)({ supabase, payload: request });
                await (dependencies.finalizeExecutionCompleted || finalizeExecutionCompleted)(supabase, request);
                return;
            }
            logExecution(cacheDecision.hit && !cacheContainsDetailedCandidates
                ? "search_cache_incompatible"
                : cacheDecision.invalid ? "search_cache_invalid" : "search_cache_miss", request, {
                cache_id: cacheDecision.row?.id || null
            });

            await markSearchCacheDecision(supabase, request, false);
            await updateProgress(supabase, request.owner_user_id, workflowRunId, {
                status: "running", started_at: new Date().toISOString(),
                current_step: "starting_search", current_message: "Starting search...",
                progress_percent: 10, estimated_remaining_seconds: null
            }, true);
            if (executionContext.shutdownReason) throw new Error(executionContext.shutdownReason);

            const runDirectory = path.join(__dirname, "..", "data", "runs", workflowRunId);
            const resultFile = path.join(__dirname, "..", "data", "workflows", workflowRunId, "final-extraction.json");
            const company = request.target.current_company || request.target.company_filter || "";
            const target = Object.freeze({
                name: request.target.name,
                linkedin_name: request.target.name,
                linkedin_url: request.target.linkedin_url || "",
                url: request.target.linkedin_url || "",
                company,
                current_company: request.target.current_company || company,
                location: request.target.location || "",
                keywords: request.target.keywords || "",
                company_filter: request.target.company_filter || "",
                school_filter: request.target.school_filter || ""
            });
            logExecution("target_resolved", request, {
                requested_name: request.target.name,
                requested_linkedin_url: request.target.linkedin_url,
                current_company: request.target.current_company,
                location: request.target.location
            });
            const scriptPath = path.resolve(__dirname, "..", "index.js");
            const cwd = path.resolve(__dirname, "..");
            console.log("[PLAYWRIGHT_SCRIPT_PATH]", {
                processExecPath: process.execPath,
                scriptPath,
                cwd,
                argv: [scriptPath]
            });
            const childEnvironment = { ...process.env };
            delete childEnvironment.PWDEBUG;
            delete childEnvironment.PWDEBUGIMPL;
            for (const secretName of ["N8N_WEBHOOK_SECRET", "N8N_EXTRACTION_WEBHOOK_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
                delete childEnvironment[secretName];
            }
            const headless = resolvePlaywrightHeadless(childEnvironment);
            console.log("[PLAYWRIGHT_LAUNCH_CONFIGURATION]", {
                browser_type: "chromium",
                headless,
                source: childEnvironment.PLAYWRIGHT_HEADLESS === undefined
                    ? "environment_default"
                    : "PLAYWRIGHT_HEADLESS",
                node_env: childEnvironment.NODE_ENV || "development"
            });
            console.log("Launching browser...");
            console.log(`Headless: ${headless}`);
            logExecution("playwright_launch_started", request);
            const child = spawnProcess(process.execPath, [scriptPath], {
                cwd, windowsHide: headless, stdio: ["ignore", "pipe", "pipe"],
                env: {
                    ...childEnvironment, OWNER_USER_ID: request.owner_user_id, WORKFLOW_RUN_ID: workflowRunId,
                    SEARCH_REQUEST_ID: request.search_request_id, SEARCH_HASH: request.normalized_search_key,
                    WARM_PATH_RUN_DIR: runDirectory, WARM_PATH_RESULT_FILE: resultFile,
                    WARM_PATH_TARGET_JSON: JSON.stringify(target), PLAYWRIGHT_HEADLESS: String(headless),
                    NODE_ENV: "production"
                }
            });
            executionContext.child = child;
            console.log(`Playwright worker PID: ${child.pid || "unknown"}`);
            const progressReader = attachProgressReader(child, supabase, request);
            activeWorkflowProcesses.set(workflowRunId, child);
            logExecution("playwright_spawned", request);
            console.log("[PLAYWRIGHT_STARTED]", {
                owner_user_id: request.owner_user_id, workflow_run_id: workflowRunId,
                search_request_id: request.search_request_id, script_path: scriptPath,
                started_at: new Date().toISOString()
            });
            try {
                await childCompletion(child);
            } catch (exitError) {
                await progressReader.completed();
                const childError = progressReader.childError();
                if (childError) {
                    const detailedError = new Error(childError.message);
                    detailedError.code = childError.code;
                    throw detailedError;
                }
                throw exitError;
            }
            await progressReader.completed();
            logExecution("playwright_completed", request, { elapsed_ms: Date.now() - startedAt });
            const markedResultFile = progressReader.resultFile() || (dependencies.readFinalExtractionResult ? resultFile : null);
            if (!markedResultFile) throw new Error("Playwright exited without emitting a final-result file marker.");
            if (path.resolve(markedResultFile) !== path.resolve(resultFile)) {
                throw new Error("Playwright emitted a result path outside the current workflow handoff contract.");
            }
            const finalResult = (dependencies.readFinalExtractionResult || readFinalExtractionResult)(markedResultFile, {
                owner_user_id: request.owner_user_id,
                workflow_run_id: workflowRunId,
                search_request_id: request.search_request_id
            });
            // The shared snapshot must retain detailed candidates, never raw mutual connections.
            const reusableProfiles = finalResult.candidates;
            const payloadBytes = Buffer.byteLength(JSON.stringify(finalResult), "utf8");
            console.log("[PLAYWRIGHT_RESULT_READY]", {
                owner_user_id: request.owner_user_id, workflow_run_id: workflowRunId,
                search_request_id: request.search_request_id, result_file: markedResultFile,
                payload_bytes: payloadBytes, connection_count: finalResult.connections.length,
                candidate_count: finalResult.candidates.length
            });
            logExecution("result_ready", request, { result_file: resultFile, candidate_count: finalResult.candidates.length });
            if (reusableProfiles.length > 0) {
                logExecution("search_cache_write_started", request, { profile_count: reusableProfiles.length });
                try {
                    const cacheWrite = await (dependencies.upsertSharedSearchCache || upsertSharedSearchCache)({
                        supabase,
                        normalizedSearchKey: request.normalized_search_key,
                        ownerUserId: request.owner_user_id,
                        sourceWorkflowRunId: workflowRunId,
                        targetName: request.target.name,
                        profiles: reusableProfiles
                    });
                    logExecution("search_cache_write_completed", request, {
                        cache_id: cacheWrite.id,
                        cache_action: cacheWrite.action,
                        profile_count: cacheWrite.profileCount
                    });
                } catch (cacheError) {
                    logExecution("search_cache_write_failed", request, {
                        error_code: cacheError?.code || "unknown",
                        error_message: String(cacheError?.message || "Shared cache persistence failed.").slice(0, 300)
                    });
                }
            } else {
                logExecution("search_cache_write_skipped", request, { reason: "empty_profile_array" });
            }
            await (dependencies.dispatchCompletedExtraction || dispatchCompletedExtraction)({
                supabase, result: finalResult, searchHash: request.normalized_search_key,
                cacheHit: false
            });
            logExecution("n8n_dispatched", request, { elapsed_ms: Date.now() - startedAt });
            await (dependencies.waitForPersistedResults || waitForPersistedResults)({ supabase, payload: request });
            logExecution("results_persisted", request, { elapsed_ms: Date.now() - startedAt });
            await (dependencies.finalizeExecutionCompleted || finalizeExecutionCompleted)(supabase, request);
            console.log("[WORKFLOW_COMPLETED]", {
                owner_user_id: request.owner_user_id, workflow_run_id: workflowRunId,
                search_request_id: request.search_request_id, completed_at: new Date().toISOString(),
                candidate_count: finalResult.candidates.length
            });
            logExecution("completed", request, { elapsed_ms: Date.now() - startedAt });
        } catch (error) {
            const failure = executionContext.shutdownReason ? new Error(executionContext.shutdownReason) : error;
            const wasStopped = Boolean(executionContext.shutdownReason);
            console[wasStopped ? "log" : "error"](wasStopped
                ? "Target search execution stopped"
                : "Target search execution failed", {
                owner_user_id: payload.owner_user_id, workflow_run_id: workflowRunId,
                search_request_id: payload.search_request_id,
                error_code: failure?.code || "PLAYWRIGHT_PIPELINE_FAILED",
                error: failure?.stack || failure?.message
            });
            if (supabase && !wasStopped) {
                let failureClient = supabase;
                if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
                    failureClient = createServiceSupabaseClient();
                }
                await markExecutionFailed({
                    supabase: failureClient, ownerUserId: payload.owner_user_id, workflowRunId,
                    searchRequestId: payload.search_request_id, error: failure
                }).catch(failureError => console.error("Workflow failure persistence failed", {
                    workflow_run_id: workflowRunId,
                    code: failureError.code,
                    message: failureError.message,
                    details: failureError.details,
                    hint: failureError.hint,
                    http_status: failureError.status
                }));
            }
        } finally {
            activeExecutions.delete(workflowRunId);
            activeExecutionContexts.delete(workflowRunId);
            activeWorkflowProcesses.delete(workflowRunId);
            console.log("[LOCAL_WORKER_JOB_COMPLETE]", {
                workflow_run_id: workflowRunId,
                search_request_id: payload.search_request_id,
                duration_ms: Date.now() - startedAt
            });
            logExecution("registry_cleared", payload, { elapsed_ms: Date.now() - startedAt });
        }
    })();

    activeExecutions.set(workflowRunId, execution);
    return { started: true, alreadyExecuting: false, promise: execution };
}

module.exports = {
    activeExecutions,
    activeExecutionContexts,
    getExecutionState,
    activeWorkflowProcesses,
    attachProgressReader,
    childCompletion,
    finalizeExecutionCompleted,
    failActiveExecutions,
    markExecutionFailed,
    markSearchCacheDecision,
    shouldReuseSearchCache,
    startTargetSearchExecution,
    terminateWorkflowProcess,
    waitForPersistedResults
};
