const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { createStopWorkflowHandler } = require("../services/workflow-api");
const { activeWorkflowProcesses, terminateWorkflowProcess } = require("../services/playwright-search-runner");

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";

function responseRecorder() {
    return {
        statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

async function invoke(resultCode, terminate = async () => ({ found: true, forced: false })) {
    let rpcName = "";
    const handler = createStopWorkflowHandler({
        createUserSupabaseClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
            rpc: async name => {
                rpcName = name;
                return ({
                data: [{ result_code: resultCode, workflow_run_id: WORKFLOW_ID, search_request_id: "search" }],
                error: null
                });
            }
        }),
        terminateWorkflowProcess: terminate
    });
    const response = responseRecorder();
    await handler({
        params: { workflowRunId: WORKFLOW_ID },
        headers: { authorization: "Bearer token" }
    }, response);
    assert.strictEqual(rpcName, "stop_workflow_run");
    return response;
}

async function run() {
    let terminations = 0;
    let response = await invoke("stopped", async () => {
        terminations += 1;
        return { found: true, forced: false };
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, "stopped");
    assert.strictEqual(terminations, 1);

    response = await invoke("terminal", async () => { throw new Error("must not terminate"); });
    assert.strictEqual(response.statusCode, 409);
    response = await invoke("not_found");
    assert.strictEqual(response.statusCode, 404, "another user's workflow remains undiscoverable");

    const gracefulChild = new EventEmitter();
    gracefulChild.killed = false;
    gracefulChild.exitCode = null;
    gracefulChild.kill = signal => {
        assert.strictEqual(signal, "SIGTERM");
        gracefulChild.killed = true;
        setImmediate(() => { gracefulChild.exitCode = 0; gracefulChild.emit("close", 0); });
    };
    activeWorkflowProcesses.set(WORKFLOW_ID, gracefulChild);
    const graceful = await terminateWorkflowProcess(WORKFLOW_ID, { graceMs: 50 });
    assert.deepStrictEqual(graceful, { found: true, forced: false });
    assert.strictEqual(activeWorkflowProcesses.has(WORKFLOW_ID), false);

    const stubbornChild = new EventEmitter();
    stubbornChild.killed = false;
    stubbornChild.exitCode = null;
    stubbornChild.pid = 9876;
    stubbornChild.kill = () => { stubbornChild.killed = true; };
    let taskkillArgs = null;
    activeWorkflowProcesses.set(WORKFLOW_ID, stubbornChild);
    const forced = await terminateWorkflowProcess(WORKFLOW_ID, {
        platform: "win32", graceMs: 1, forceWaitMs: 1,
        spawn: (command, args) => {
            assert.strictEqual(command, "taskkill");
            taskkillArgs = args;
            const killer = new EventEmitter();
            setImmediate(() => killer.emit("close", 0));
            return killer;
        }
    });
    assert.strictEqual(forced.forced, true);
    assert.deepStrictEqual(taskkillArgs, ["/PID", "9876", "/T", "/F"]);

    const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202607190002_stop_workflow.sql"), "utf8");
    assert.match(migration, /stop_workflow_run/);
    assert.match(migration, /status = 'stopped'/);
    assert.match(migration, /finished_at = stopped_at/);
    assert.match(migration, /owner_user_id = current_owner/);
    assert.match(migration, /lower\(status\) in \('queued', 'running', 'starting', 'processing', 'in_progress'\)/);
    const recoveryMigration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202607190001_search_lifecycle_recovery.sql"), "utf8");
    assert.match(recoveryMigration, /in \('queued', 'running', 'starting', 'processing', 'in_progress'\)/);

    const pipeline = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    for (const stage of ["target search", "mutual collection", "profile processing", "classification", "final result handoff"]) {
        assert.match(pipeline, new RegExp(stage));
    }
    console.log("Workflow stop tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
