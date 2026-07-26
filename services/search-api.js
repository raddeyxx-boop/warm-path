const { createUserSupabaseClient } = require("./supabase-server");
const { startTargetSearchExecution } = require("./playwright-search-runner");
const { randomUUID } = require("crypto");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = new Set(["workflow_run_id", "search_request_id"]);

function errorResponse(res, status, code, message, errorId) {
    return res.status(status).json({ success: false, code, message, ...(errorId ? { error_id: errorId } : {}) });
}

function databaseErrorDetails(error) {
    return {
        code: error?.code || "unknown",
        message: error?.message || "unknown",
        details: error?.details || null,
        hint: error?.hint || null
    };
}

async function markSearchStartFailed(supabase, { ownerUserId, workflowRunId, searchRequestId, errorId }) {
    if (!supabase || !ownerUserId) return;
    const failedAt = new Date().toISOString();
    const message = `Search startup failed. Reference: ${errorId}`;
    if (typeof supabase.rpc === "function") {
        const transaction = await supabase.rpc("fail_target_search_pair", {
            p_workflow_run_id: workflowRunId,
            p_search_request_id: searchRequestId,
            p_error_message: message
        });
        if (!transaction.error) return;
        if (!/PGRST202|42883/.test(transaction.error.code || "")) throw transaction.error;
    }
    const [workflow, search] = await Promise.all([
        supabase.from("workflow_runs").update({
            status: "failed", failed_at: failedAt, current_step: "failed",
            current_message: "Search failed to start.", estimated_remaining_seconds: null
        }).eq("id", workflowRunId).eq("owner_user_id", ownerUserId)
            .in("status", ["queued", "running", "starting", "processing", "in_progress"]),
        supabase.from("search_requests").update({
            status: "failed", failed_at: failedAt, error_message: message
        }).eq("id", searchRequestId).eq("workflow_run_id", workflowRunId)
            .eq("owner_user_id", ownerUserId)
            .in("status", ["queued", "running", "starting", "processing", "in_progress"])
    ]);
    if (workflow.error || search.error) throw workflow.error || search.error;
}

function readBearerToken(req) {
    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : "";
}

function validRequestBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    if (Object.keys(body).some(key => !REQUEST_FIELDS.has(key))) return false;
    return UUID_PATTERN.test(body.workflow_run_id || "") && UUID_PATTERN.test(body.search_request_id || "");
}

async function buildExecutionPayload(row) {
    const { normalizeLinkedInProfileUrl, validateTargetSearchRequest } = await import("../types/target-search-request.ts");
    const linkedinUrl = normalizeLinkedInProfileUrl(row.linkedin_url || row.linkedin_name);
    return validateTargetSearchRequest({
        owner_user_id: row.owner_user_id,
        workflow_run_id: row.workflow_run_id,
        search_request_id: row.search_request_id,
        target: {
            name: row.target_name,
            current_company: row.current_company,
            linkedin_url: linkedinUrl,
            location: row.location,
            keywords: row.keywords,
            company_filter: row.company_filter,
            school_filter: row.school_filter
        },
        normalized_search_key: row.normalized_search_key
    });
}

function createStartSearchHandler(options = {}) {
    const createClient = options.createUserSupabaseClient || createUserSupabaseClient;
    const prepareExecution = options.prepareExecution || buildExecutionPayload;
    const startExecution = options.startTargetSearchExecution || startTargetSearchExecution;

    return async function startSearch(req, res) {
        const accessToken = readBearerToken(req);
        if (!accessToken) {
            return errorResponse(res, 401, "UNAUTHORIZED", "Authentication is required.");
        }

        if (!validRequestBody(req.body)) {
            return errorResponse(res, 400, "INVALID_REQUEST", "The search request is invalid.");
        }

        const workflowRunId = req.body.workflow_run_id;
        const searchRequestId = req.body.search_request_id;
        const requestStartedAt = Date.now();
        let supabase = null;
        let ownerUserId = null;

        try {
            supabase = createClient(accessToken);
            const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

            if (userError || !userData?.user?.id) {
                console.warn("Search API authentication rejected", { workflow_run_id: workflowRunId, search_request_id: searchRequestId });
                return errorResponse(res, 401, "UNAUTHORIZED", "Your session is invalid or expired.");
            }

            ownerUserId = userData.user.id;
            const { error: recoveryError } = await supabase.rpc("recover_abandoned_target_searches");
            if (recoveryError) throw recoveryError;
            const { error: progressError } = await supabase.from("workflow_runs").update({
                current_step: "checking_cache",
                current_message: "Checking for cached searches...",
                progress_percent: 5,
                estimated_remaining_seconds: null
            }).eq("id", workflowRunId).eq("owner_user_id", ownerUserId);
            if (progressError) throw progressError;
            const { data, error } = await supabase.rpc("start_target_search", {
                p_workflow_run_id: workflowRunId,
                p_search_request_id: searchRequestId
            });

            if (error) {
                const errorId = randomUUID();
                console.error("Search API database failure", {
                    error_id: errorId,
                    workflow_run_id: workflowRunId,
                    search_request_id: searchRequestId,
                    owner_user_id: ownerUserId,
                    ...databaseErrorDetails(error)
                });
                await markSearchStartFailed(supabase, {
                    ownerUserId, workflowRunId, searchRequestId, errorId
                }).catch(failureError => console.error("Search API failure synchronization failed", {
                    error_id: errorId, workflow_run_id: workflowRunId,
                    search_request_id: searchRequestId, ...databaseErrorDetails(failureError)
                }));
                const status = ["23505", "40001"].includes(error.code) ? 409 : 500;
                const code = status === 409 ? "INVALID_SEARCH_STATE" : "DATABASE_ERROR";
                const message = status === 409 ? "The search state changed before it could be prepared." : "Unable to prepare the search.";
                return errorResponse(res, status, code, message, errorId);
            }

            const result = data?.[0];
            if (!result || result.result_code === "not_found") {
                return errorResponse(res, 404, "SEARCH_NOT_FOUND", "The search was not found.");
            }
            if (result.result_code === "active_search") {
                return errorResponse(res, 409, "ACTIVE_SEARCH_EXISTS", "You already have a search in progress.");
            }
            if (result.result_code === "invalid_state") {
                return errorResponse(res, 409, "INVALID_SEARCH_STATE", "The search cannot be started in its current state.");
            }
            if (!["started", "already_started"].includes(result.result_code)) {
                return errorResponse(res, 500, "INTERNAL_ERROR", "Unable to prepare the search.");
            }

            const executionPayload = await prepareExecution(result);

            if (executionPayload) {
                console.log("Search API automation input", {
                    workflow_run_id: executionPayload.workflow_run_id,
                    search_request_id: executionPayload.search_request_id,
                    resolved_target_name: executionPayload.target.name,
                    resolved_linkedin_url: executionPayload.target.linkedin_url
                });
            }

            const launch = startExecution(executionPayload, accessToken);

            console.log("Search API execution dispatched", {
                workflow_run_id: workflowRunId, search_request_id: searchRequestId,
                owner_user_id: ownerUserId, already_executing: launch.alreadyExecuting,
                elapsed_ms: Date.now() - requestStartedAt
            });

            return res.json({
                success: true,
                cache_hit: null,
                already_executing: launch.alreadyExecuting,
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                status: "running",
                next_action: "cache_check_pending",
                message: "Search execution started."
            });
        } catch (error) {
            const errorId = randomUUID();
            console.error("Search API unexpected failure", {
                error_id: errorId,
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                ...databaseErrorDetails(error)
            });
            await markSearchStartFailed(supabase, {
                ownerUserId, workflowRunId, searchRequestId, errorId
            }).catch(failureError => console.error("Search API failure synchronization failed", {
                error_id: errorId, workflow_run_id: workflowRunId,
                search_request_id: searchRequestId, ...databaseErrorDetails(failureError)
            }));
            const isConfigurationError = error.code === "SUPABASE_CONFIG_MISSING";
            return errorResponse(
                res,
                500,
                isConfigurationError ? "DATABASE_ERROR" : "INTERNAL_ERROR",
                isConfigurationError ? "Unable to connect to Supabase." : "Unable to prepare the search.",
                errorId
            );
        }
    };
}

module.exports = {
    UUID_PATTERN,
    buildExecutionPayload,
    createStartSearchHandler,
    databaseErrorDetails,
    markSearchStartFailed,
    readBearerToken,
    validRequestBody
};
