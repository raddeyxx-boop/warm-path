const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createDeleteWorkflowHandler } = require("../services/workflow-api");

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";

function responseRecorder() {
    return {
        statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function clientFor(options = {}) {
    return {
        auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
        from: () => ({
            select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: options.found === false ? null : { id: WORKFLOW_ID }, error: null }) })
            })
        }),
        rpc: async (name, params) => {
            assert.strictEqual(name, "delete_workflow_run");
            assert.deepStrictEqual(params, { p_workflow_run_id: WORKFLOW_ID });
            return {
                data: [{ result_code: options.resultCode || "deleted", workflow_run_id: WORKFLOW_ID }],
                error: null
            };
        }
    };
}

async function invoke(options = {}) {
    let terminations = 0;
    const handler = createDeleteWorkflowHandler({
        createUserSupabaseClient: () => clientFor(options),
        terminateWorkflowProcess: async id => {
            assert.strictEqual(id, WORKFLOW_ID);
            terminations += 1;
            return { found: false, forced: false };
        }
    });
    const response = responseRecorder();
    await handler({
        params: { workflowRunId: options.id || WORKFLOW_ID },
        headers: { authorization: options.authorization === false ? "" : "Bearer token" }
    }, response);
    return { response, terminations };
}

async function run() {
    let result = await invoke();
    assert.strictEqual(result.response.statusCode, 200);
    assert.strictEqual(result.response.body.status, "deleted");
    assert.strictEqual(result.terminations, 1);

    result = await invoke({ found: false });
    assert.strictEqual(result.response.statusCode, 404);
    assert.strictEqual(result.terminations, 0, "unauthorized or missing runs must not terminate a process");

    result = await invoke({ id: "invalid" });
    assert.strictEqual(result.response.statusCode, 400);
    assert.strictEqual(result.terminations, 0);

    result = await invoke({ authorization: false });
    assert.strictEqual(result.response.statusCode, 401);

    const migration = fs.readFileSync(
        path.join(__dirname, "..", "supabase", "migrations", "202607200001_delete_workflow_run.sql"),
        "utf8"
    );
    for (const table of ["search_cache", "search_requests", "top_candidates", "ranked_candidates", "workflow_runs"]) {
        assert.match(migration, new RegExp(`delete from public\\.${table}`));
    }
    assert.match(migration, /security definer/);
    assert.match(migration, /not public\.is_active_user\(\)/);
    assert.match(migration, /workflow_owner is distinct from current_owner and not public\.is_admin\(\)/);
    assert.match(migration, /information_schema\.columns/);
    assert.match(migration, /run_id::text = \$1/);
    assert.doesNotMatch(migration, /where\s+workflow_run_id\s*=\s*p_workflow_run_id/i);

    const repairMigration = fs.readFileSync(
        path.join(__dirname, "..", "supabase", "migrations", "202607200002_fix_delete_workflow_run.sql"),
        "utf8"
    );
    assert.match(repairMigration, /where sr\.workflow_run_id = p_workflow_run_id/);
    assert.match(repairMigration, /where tc\.workflow_run_id = p_workflow_run_id/);
    assert.match(repairMigration, /where rc\.workflow_run_id = p_workflow_run_id/);
    assert.match(repairMigration, /where sc\.source_workflow_run_id = p_workflow_run_id/);
    assert.match(repairMigration, /where wr\.id = p_workflow_run_id/);
    assert.match(repairMigration, /where c\.table_schema = 'public'/);
    assert.doesNotMatch(repairMigration, /where\s+workflow_run_id\s*=/i);
    assert.doesNotMatch(repairMigration, /where\s+source_workflow_run_id\s*=/i);
    assert.doesNotMatch(repairMigration, /where\s+id\s*=\s*p_workflow_run_id/i);

    const detailsPage = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "RunDetails.jsx"), "utf8");
    const clientService = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "services", "workflowService.js"), "utf8");
    const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    assert.match(detailsPage, /await deleteWorkflow\(run\.id\)/);
    assert.match(detailsPage, /runId=\{run\.id\}/);
    assert.match(detailsPage, /Run ID:<\/strong>\s*\{runId\}/);
    assert.match(clientService, /method: 'DELETE'/);
    assert.match(server, /app\.delete\("\/api\/workflows\/:workflowRunId"/);
    console.log("Workflow delete tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
