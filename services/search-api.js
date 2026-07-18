const { createUserSupabaseClient } = require("./supabase-server");
const { cacheDecisionFromRow } = require("./search-cache");
const { startTargetSearchExecution } = require("./playwright-search-runner");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = new Set(["workflow_run_id", "search_request_id"]);

function errorResponse(res, status, code, message) {
    return res.status(status).json({ success: false, code, message });
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

function buildExecutionPayload(row) {
    return {
        owner_user_id: row.owner_user_id,
        workflow_run_id: row.workflow_run_id,
        search_request_id: row.search_request_id,
        target: {
            target_name: row.target_name,
            current_company: row.current_company,
            linkedin_name: row.linkedin_name,
            location: row.location
        },
        filters: {
            keywords: row.keywords,
            company_filter: row.company_filter,
            school_filter: row.school_filter
        },
        normalized_search_key: row.normalized_search_key
    };
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

        try {
            const supabase = createClient(accessToken);
            const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

            if (userError || !userData?.user?.id) {
                console.warn("Search API authentication rejected", { workflow_run_id: workflowRunId, search_request_id: searchRequestId });
                return errorResponse(res, 401, "UNAUTHORIZED", "Your session is invalid or expired.");
            }

            const ownerUserId = userData.user.id;
            const { error: progressError } = await supabase.from("workflow_runs").update({
                current_step: "checking_cache",
                current_message: "Checking for cached searches...",
                progress_percent: 5,
                estimated_remaining_seconds: 30
            }).eq("id", workflowRunId).eq("owner_user_id", ownerUserId);
            if (progressError) throw progressError;
            const { data, error } = await supabase.rpc("prepare_target_search_with_cache", {
                p_workflow_run_id: workflowRunId,
                p_search_request_id: searchRequestId
            });

            if (error) {
                console.error("Search API database failure", {
                    workflow_run_id: workflowRunId,
                    search_request_id: searchRequestId,
                    owner_user_id: ownerUserId,
                    code: error.code || "unknown"
                });
                const status = ["23505", "40001"].includes(error.code) ? 409 : 500;
                const code = status === 409 ? "INVALID_SEARCH_STATE" : "CACHE_COPY_FAILED";
                const message = status === 409 ? "The search state changed before it could be prepared." : "Unable to apply cached search results.";
                return errorResponse(res, status, code, message);
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
            if (!["cache_hit", "cache_miss", "cache_invalid"].includes(result.result_code)) {
                return errorResponse(res, 500, "INTERNAL_ERROR", "Unable to prepare the search.");
            }

            const cacheDecision = cacheDecisionFromRow(result);
            const executionPayload = cacheDecision.hit ? null : prepareExecution(result);
            const searchKeyPrefix = (result.normalized_search_key || "").slice(0, 12);

            console.log("Search API cache decision", {
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                owner_user_id: ownerUserId,
                normalized_search_key_prefix: searchKeyPrefix,
                cache_hit: cacheDecision.hit,
                cache_invalid: Boolean(cacheDecision.invalid),
                cache_id: cacheDecision.cacheId,
                copied_candidate_count: cacheDecision.hit ? cacheDecision.copiedCandidateCount : 0,
                copied_top_candidate_count: cacheDecision.hit ? cacheDecision.copiedTopCandidateCount : 0
            });

            // Cache misses continue through the managed Step 7 Playwright execution.
            void executionPayload;

            if (cacheDecision.hit) {
                const { error: completionError } = await supabase.from("workflow_runs").update({
                    cache_hit: true,
                    current_step: "completed",
                    current_message: "Search completed successfully.",
                    progress_percent: 100,
                    estimated_remaining_seconds: 0
                }).eq("id", workflowRunId).eq("owner_user_id", ownerUserId);
                if (completionError) throw completionError;
                console.log("Search API request completed", {
                    workflow_run_id: workflowRunId, search_request_id: searchRequestId,
                    owner_user_id: ownerUserId, outcome: "cache_hit",
                    elapsed_ms: Date.now() - requestStartedAt
                });
                return res.json({
                    success: true,
                    cache_hit: true,
                    workflow_run_id: workflowRunId,
                    search_request_id: searchRequestId,
                    status: "completed",
                    copied_candidate_count: cacheDecision.copiedCandidateCount,
                    message: "Search completed using cached results."
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
                cache_hit: false,
                already_executing: launch.alreadyExecuting,
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                status: "running",
                next_action: "playwright_required",
                message: "No valid cache was found. Search is ready for execution."
            });
        } catch (error) {
            console.error("Search API unexpected failure", {
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                code: error.code || "unknown"
            });
            const isConfigurationError = error.code === "SUPABASE_CONFIG_MISSING";
            return errorResponse(
                res,
                500,
                isConfigurationError ? "DATABASE_ERROR" : "INTERNAL_ERROR",
                isConfigurationError ? "Unable to connect to Supabase." : "Unable to prepare the search."
            );
        }
    };
}

module.exports = {
    UUID_PATTERN,
    buildExecutionPayload,
    createStartSearchHandler,
    readBearerToken,
    validRequestBody
};
