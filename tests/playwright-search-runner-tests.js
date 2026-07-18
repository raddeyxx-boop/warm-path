const assert = require("assert");
const { EventEmitter } = require("events");
const {
    activeExecutions,
    startTargetSearchExecution,
    waitForPersistedResults
} = require("../services/playwright-search-runner");

const payload = {
    owner_user_id: "33333333-3333-4333-8333-333333333333",
    workflow_run_id: "11111111-1111-4111-8111-111111111111",
    search_request_id: "22222222-2222-4222-8222-222222222222",
    normalized_search_key: "search-key",
    target: { target_name: "Target", current_company: "Company", linkedin_name: "Target", location: "Location" },
    filters: { keywords: "", company_filter: "", school_filter: "" }
};

function mockSupabase(updates) {
    return {
        from(table) {
            const query = {
                update(values) { updates.push({ table, values }); return query; },
                eq() { return query; },
                then(resolve) { resolve({ error: null }); }
            };
            return query;
        }
    };
}

function mockSpawn(exitCode, calls) {
    return (...args) => {
        calls.push(args);
        const child = new EventEmitter();
        setImmediate(() => child.emit("close", exitCode));
        return child;
    };
}

async function run() {
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_ANON_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";

    try {
        const successUpdates = [];
        const successCalls = [];
        const dependencies = {
            spawn: mockSpawn(0, successCalls),
            createUserSupabaseClient: () => mockSupabase(successUpdates),
            waitForPersistedResults: async () => ({ candidateCount: 1 }),
            cacheCompletedWorkflow: async () => {},
            finalizeExecutionCompleted: async () => {}
        };
        const first = startTargetSearchExecution(payload, "token", dependencies);
        const duplicate = startTargetSearchExecution(payload, "token", dependencies);
        assert.strictEqual(first.started, true);
        assert.strictEqual(duplicate.started, false);
        assert.strictEqual(duplicate.alreadyExecuting, true);
        assert.strictEqual(successCalls.length, 0, "HTTP launch returns before asynchronous process creation");
        await first.promise;
        assert.strictEqual(successCalls.length, 1);
        assert.ok(successCalls[0][1][0].endsWith("index.js"), "reuses the existing Playwright pipeline entry point");
        assert.strictEqual(successCalls[0][2].env.PLAYWRIGHT_HEADLESS, "true");
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        let clientFailureSpawned = false;
        const clientFailure = startTargetSearchExecution(payload, "token", {
            spawn: () => { clientFailureSpawned = true; },
            createUserSupabaseClient: () => { throw new Error("client construction failed"); }
        });
        await clientFailure.promise;
        assert.strictEqual(clientFailureSpawned, false);
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const failureUpdates = [];
        const failed = startTargetSearchExecution(payload, "token", {
            spawn: mockSpawn(1, []),
            createUserSupabaseClient: () => mockSupabase(failureUpdates)
        });
        await failed.promise;
        assert.ok(failureUpdates.some(update => update.table === "workflow_runs" && update.values.status === "failed"));
        assert.ok(failureUpdates.some(update => update.table === "search_requests" && update.values.status === "failed"));
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        delete process.env.SUPABASE_URL;
        const missingEnvironmentUpdates = [];
        const missing = startTargetSearchExecution(payload, "token", {
            spawn: () => { throw new Error("must not spawn"); },
            createUserSupabaseClient: () => mockSupabase(missingEnvironmentUpdates)
        });
        await missing.promise;
        assert.ok(missingEnvironmentUpdates.some(update => update.values.status === "failed"));
        process.env.SUPABASE_URL = "https://example.supabase.co";

        let completedMarked = 0;
        let completedReads = 0;
        const completedState = await waitForPersistedResults({
            supabase: {}, payload, timeoutMs: 100, pollIntervalMs: 1,
            readState: async () => ++completedReads === 1
                ? { workflowStatus: "running", searchStatus: "running", candidateCount: 2 }
                : { workflowStatus: "completed", searchStatus: "completed", candidateCount: 2 },
            markCompleted: async () => { completedMarked += 1; },
            sleep: async () => {}, now: () => 0
        });
        assert.strictEqual(completedState.candidateCount, 2);
        assert.strictEqual(completedMarked, 1);

        await assert.rejects(() => waitForPersistedResults({
            supabase: {}, payload, timeoutMs: 100,
            readState: async () => ({ workflowStatus: "failed", searchStatus: "failed", candidateCount: 0 }),
            sleep: async () => {}, now: () => 0
        }), /terminal state/);

        async function assertPersistenceTimeout(state) {
            let time = 0;
            await assert.rejects(() => waitForPersistedResults({
                supabase: {}, payload, timeoutMs: 10, pollIntervalMs: 5,
                readState: async () => state,
                sleep: async milliseconds => { time += milliseconds; },
                now: () => time
            }), /Timed out waiting for analyzed candidates to be persisted/);
        }
        await assertPersistenceTimeout({ workflowStatus: "running", searchStatus: "running", candidateCount: 0 });
        await assertPersistenceTimeout({ workflowStatus: "completed", searchStatus: "completed", candidateCount: 0 });

        const timeoutUpdates = [];
        const timedOutExecution = startTargetSearchExecution(payload, "token", {
            spawn: mockSpawn(0, []),
            createUserSupabaseClient: () => mockSupabase(timeoutUpdates),
            waitForPersistedResults: async () => { throw new Error("Timed out waiting for analyzed candidates to be persisted."); },
            cacheCompletedWorkflow: async () => { throw new Error("cache must not run"); },
            finalizeExecutionCompleted: async () => { throw new Error("completion must not run"); }
        });
        await timedOutExecution.promise;
        assert.ok(timeoutUpdates.some(update => update.table === "workflow_runs" && update.values.status === "failed"));
        assert.ok(timeoutUpdates.some(update => update.table === "search_requests" && update.values.status === "failed"));
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const ordering = [];
        const ordered = startTargetSearchExecution(payload, "token", {
            spawn: mockSpawn(0, []),
            createUserSupabaseClient: () => mockSupabase([]),
            waitForPersistedResults: async () => { ordering.push("verified"); },
            cacheCompletedWorkflow: async () => { ordering.push("cached"); },
            finalizeExecutionCompleted: async () => { ordering.push("completed"); }
        });
        await ordered.promise;
        assert.deepStrictEqual(ordering, ["verified", "cached", "completed"]);
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const cacheFailureUpdates = [];
        let completedAfterCacheFailure = false;
        const cacheFailed = startTargetSearchExecution(payload, "token", {
            spawn: mockSpawn(0, []),
            createUserSupabaseClient: () => mockSupabase(cacheFailureUpdates),
            waitForPersistedResults: async () => ({ candidateCount: 1 }),
            cacheCompletedWorkflow: async () => { throw new Error("cache refresh failed"); },
            finalizeExecutionCompleted: async () => { completedAfterCacheFailure = true; }
        });
        await cacheFailed.promise;
        assert.strictEqual(completedAfterCacheFailure, false);
        assert.ok(cacheFailureUpdates.some(update => update.table === "workflow_runs" && update.values.status === "failed"));
        assert.ok(cacheFailureUpdates.some(update => update.table === "search_requests" && update.values.status === "failed"));
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        console.log("Playwright search runner tests passed.");
    } finally {
        if (previousUrl === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = previousUrl;
        if (previousKey === undefined) delete process.env.SUPABASE_ANON_KEY;
        else process.env.SUPABASE_ANON_KEY = previousKey;
        activeExecutions.clear();
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
