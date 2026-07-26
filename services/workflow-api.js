const { createUserSupabaseClient } = require("./supabase-server");
const { terminateWorkflowProcess } = require("./playwright-search-runner");
const { randomUUID } = require("crypto");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearerToken(req) {
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : "";
}

function createStopWorkflowHandler(options = {}) {
    const createClient = options.createUserSupabaseClient || createUserSupabaseClient;
    const terminate = options.terminateWorkflowProcess || terminateWorkflowProcess;

    return async function stopWorkflow(req, res) {
        const workflowRunId = req.params.workflowRunId;
        const accessToken = bearerToken(req);
        if (!accessToken) return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Authentication is required." });
        if (!UUID_PATTERN.test(workflowRunId || "")) {
            return res.status(400).json({ success: false, code: "INVALID_WORKFLOW_ID", message: "The workflow identifier is invalid." });
        }

        try {
            const supabase = createClient(accessToken);
            const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
            if (userError || !userData?.user?.id) {
                return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Your session is invalid or expired." });
            }

            const { data, error } = await supabase.rpc("stop_workflow_run", { p_workflow_run_id: workflowRunId });
            if (error) throw error;
            const result = data?.[0];
            if (!result || result.result_code === "not_found") {
                return res.status(404).json({ success: false, code: "WORKFLOW_NOT_FOUND", message: "The workflow was not found." });
            }
            if (result.result_code === "terminal") {
                return res.status(409).json({ success: false, code: "WORKFLOW_NOT_ACTIVE", message: "This workflow has already finished." });
            }
            if (result.result_code !== "stopped") throw new Error(`Unexpected stop result: ${result.result_code}`);

            const termination = await terminate(workflowRunId, { reason: "Workflow stopped by user." });
            console.log("Workflow stop", {
                workflow_run_id: workflowRunId,
                search_request_id: result.search_request_id || null,
                owner_user_id: userData.user.id,
                process_found: termination.found,
                force_killed: termination.forced
            });
            return res.json({
                success: true,
                status: "stopped",
                workflow_run_id: workflowRunId,
                search_request_id: result.search_request_id || null,
                message: "Workflow stopped by user."
            });
        } catch (error) {
            console.error("Workflow stop failed", {
                workflow_run_id: workflowRunId,
                code: error.code || "unknown",
                message: error.message,
                details: error.details || null,
                hint: error.hint || null
            });
            return res.status(500).json({ success: false, code: "WORKFLOW_STOP_FAILED", message: "Unable to stop the workflow." });
        }
    };
}

function createDeleteWorkflowHandler(options = {}) {
    const createClient = options.createUserSupabaseClient || createUserSupabaseClient;
    const terminate = options.terminateWorkflowProcess || terminateWorkflowProcess;

    return async function deleteWorkflow(req, res) {
        const workflowRunId = req.params.workflowRunId;
        const accessToken = bearerToken(req);
        if (!accessToken) return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Authentication is required." });
        if (!UUID_PATTERN.test(workflowRunId || "")) {
            return res.status(400).json({ success: false, code: "INVALID_WORKFLOW_ID", message: "The workflow identifier is invalid." });
        }

        try {
            const supabase = createClient(accessToken);
            const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
            if (userError || !userData?.user?.id) {
                return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Your session is invalid or expired." });
            }

            // RLS makes another user's run indistinguishable from a missing run.
            const { data: ownedRun, error: lookupError } = await supabase
                .from("workflow_runs")
                .select("id")
                .eq("id", workflowRunId)
                .maybeSingle();
            if (lookupError) throw lookupError;
            if (!ownedRun?.id) {
                return res.status(404).json({ success: false, code: "WORKFLOW_NOT_FOUND", message: "The workflow was not found." });
            }

            await terminate(workflowRunId, { reason: "Workflow permanently deleted by user." });
            const { data, error } = await supabase.rpc("delete_workflow_run", { p_workflow_run_id: workflowRunId });
            if (error) throw error;
            const result = data?.[0];
            if (!result || result.result_code === "not_found") {
                return res.status(404).json({ success: false, code: "WORKFLOW_NOT_FOUND", message: "The workflow was not found." });
            }
            if (result.result_code !== "deleted") throw new Error(`Unexpected delete result: ${result.result_code}`);

            console.log("Workflow deleted", { workflow_run_id: workflowRunId, owner_user_id: userData.user.id });
            return res.json({ success: true, status: "deleted", ...result, message: "Workflow run permanently deleted." });
        } catch (error) {
            const errorId = randomUUID();
            console.error("Workflow delete failed", {
                error_id: errorId,
                workflow_run_id: workflowRunId,
                code: error.code || "unknown",
                message: error.message,
                details: error.details || null,
                hint: error.hint || null
            });
            return res.status(500).json({
                success: false,
                code: "WORKFLOW_DELETE_FAILED",
                database_code: error.code || null,
                error_id: errorId,
                message: "Unable to delete the workflow run."
            });
        }
    };
}

module.exports = { UUID_PATTERN, createStopWorkflowHandler, createDeleteWorkflowHandler };
