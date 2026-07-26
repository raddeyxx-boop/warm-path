const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { recoverAbandonedSearches } = require("../services/search-recovery");
const { activeExecutionContexts, activeWorkflowProcesses, failActiveExecutions } = require("../services/playwright-search-runner");
const { installProcessHandlers } = require("../server");

async function run() {
    const recovered = await recoverAbandonedSearches({
        createServiceSupabaseClient: () => ({
            rpc: async name => {
                assert.strictEqual(name, "recover_abandoned_searches_on_backend_start");
                return { data: [{ search_id: "22222222-2222-4222-8222-222222222222" }], error: null };
            }
        })
    });
    assert.strictEqual(recovered.length, 1);

    let killed = false;
    let failedReason = "";
    const shutdownChild = { killed: false, exitCode: null, once() {}, kill: signal => { assert.strictEqual(signal, "SIGTERM"); killed = true; shutdownChild.killed = true; shutdownChild.exitCode = 0; } };
    activeExecutionContexts.set("workflow", {
        payload: {
            owner_user_id: "owner", workflow_run_id: "workflow", search_request_id: "search"
        },
        accessToken: "token",
        createClient: () => ({
            rpc: async (name, values) => {
                assert.strictEqual(name, "fail_target_search_pair");
                failedReason = values.p_error_message;
                return { data: true, error: null };
            }
        }),
        child: shutdownChild,
        shutdownReason: null
    });
    activeWorkflowProcesses.set("workflow", shutdownChild);
    await failActiveExecutions("Search interrupted by SIGTERM.");
    assert.strictEqual(killed, true);
    assert.strictEqual(failedReason, "Search interrupted by SIGTERM.");
    activeExecutionContexts.clear();
    activeWorkflowProcesses.clear();

    let failReason = "";
    let exitCode = null;
    const server = { listening: false };
    const lifecycle = installProcessHandlers(server, {
        failActiveExecutions: async reason => { failReason = reason; },
        exit: code => { exitCode = code; }
    });
    assert.deepStrictEqual(Object.keys(lifecycle.handlers).sort(), ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"].sort());
    await lifecycle.shutdown("Search interrupted by SIGINT (Ctrl+C).", 130);
    assert.strictEqual(failReason, "Search interrupted by SIGINT (Ctrl+C).");
    assert.strictEqual(exitCode, 130);
    Object.entries(lifecycle.handlers).forEach(([event, handler]) => process.removeListener(event, handler));

    const migration = fs.readFileSync(path.join(
        __dirname, "..", "supabase", "migrations", "202607190001_search_lifecycle_recovery.sql"
    ), "utf8");
    assert.match(migration, /recover_abandoned_searches_on_backend_start/);
    assert.match(migration, /Search interrupted because the backend was restarted\./);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /finished_at = recovery_time/);
    assert.match(migration, /fail_target_search_pair/);
    assert.match(migration, /grant execute .*service_role/);
    console.log("Search recovery tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
