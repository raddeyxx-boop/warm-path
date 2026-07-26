const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    buildExecutionPayload,
    createStartSearchHandler,
    validRequestBody
} = require("../services/search-api");
const {
    cacheDecisionFromRow,
    findValidSharedSearchCache,
    upsertSharedSearchCache
} = require("../services/search-cache");

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const SEARCH_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

function request(body, token = "valid-token") {
    return {
        body,
        headers: token ? { authorization: `Bearer ${token}` } : {}
    };
}

function rpcRow(resultCode = "started") {
    return {
        result_code: resultCode,
        owner_user_id: OWNER_ID,
        workflow_run_id: WORKFLOW_ID,
        search_request_id: SEARCH_ID,
        target_name: "Trusted Target",
        current_company: "Trusted Company",
        linkedin_name: "linkedin.com/in/trusted-target",
        location: "Trusted Location",
        keywords: "fintech",
        company_filter: "OpenAI",
        school_filter: "Stanford",
        normalized_search_key: "trusted-key",
        cache_id: resultCode === "cache_hit" ? "44444444-4444-4444-8444-444444444444" : null,
        source_workflow_run_id: resultCode === "cache_hit" ? "55555555-5555-4555-8555-555555555555" : null,
        copied_candidate_count: resultCode === "cache_hit" ? 12 : 0,
        copied_top_candidate_count: resultCode === "cache_hit" ? 3 : 0
    };
}

function mockClient({ authError = null, resultCode = "started", rpcError = null, updateLog = [], rpcLog = [] } = {}) {
    const updateQuery = table => ({
        update(values) { updateLog.push({ table, values }); return this; },
        eq() { return this; },
        in() { return this; },
        then(resolve) { resolve({ error: null }); }
    });
    return {
        auth: {
            getUser: async () => ({
                data: authError ? null : { user: { id: OWNER_ID } },
                error: authError
            })
        },
        rpc: async (name, values) => {
            rpcLog.push({ name, values });
            if (name === "recover_abandoned_target_searches") return { data: 0, error: null };
            if (name === "fail_target_search_pair") return { data: null, error: { code: "PGRST202" } };
            return { data: rpcError ? null : [rpcRow(resultCode)], error: rpcError };
        },
        from: table => updateQuery(table)
    };
}

async function invoke(options = {}, body = { workflow_run_id: WORKFLOW_ID, search_request_id: SEARCH_ID }, token = "valid-token") {
    const handler = createStartSearchHandler({
        createUserSupabaseClient: () => mockClient(options),
        prepareExecution: options.prepareExecution,
        startTargetSearchExecution: options.startTargetSearchExecution || (() => ({ started: true, alreadyExecuting: false, promise: Promise.resolve() }))
    });
    const res = responseRecorder();
    await handler(request(body, token), res);
    return res;
}

async function run() {
    assert.strictEqual(validRequestBody({ workflow_run_id: WORKFLOW_ID, search_request_id: SEARCH_ID }), true);
    assert.strictEqual(validRequestBody({ workflow_run_id: "bad", search_request_id: SEARCH_ID }), false);
    assert.strictEqual(validRequestBody({ workflow_run_id: WORKFLOW_ID, search_request_id: SEARCH_ID, owner_user_id: OWNER_ID }), false);

    let response = await invoke({}, undefined, "");
    assert.strictEqual(response.statusCode, 401);
    assert.strictEqual(response.body.code, "UNAUTHORIZED");

    response = await invoke({ authError: { message: "invalid token" } });
    assert.strictEqual(response.statusCode, 401);

    response = await invoke({}, { workflow_run_id: "bad", search_request_id: SEARCH_ID });
    assert.strictEqual(response.statusCode, 400);

    response = await invoke({ resultCode: "not_found" });
    assert.strictEqual(response.statusCode, 404);
    assert.strictEqual(response.body.code, "SEARCH_NOT_FOUND");

    response = await invoke({ resultCode: "invalid_state" });
    assert.strictEqual(response.statusCode, 409);
    assert.strictEqual(response.body.code, "INVALID_SEARCH_STATE");

    response = await invoke({ resultCode: "active_search" });
    assert.strictEqual(response.statusCode, 409);
    assert.strictEqual(response.body.code, "ACTIVE_SEARCH_EXISTS");

    let executionStarts = 0;

    let preparedPayload;
    const rpcLog = [];
    response = await invoke({
        resultCode: "started",
        rpcLog,
        prepareExecution: async row => {
            preparedPayload = await buildExecutionPayload(row);
            return preparedPayload;
        },
        startTargetSearchExecution: () => { executionStarts += 1; return { started: true, alreadyExecuting: false }; }
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, "running");
    assert.strictEqual(response.body.cache_hit, null);
    assert.strictEqual(response.body.next_action, "cache_check_pending");
    assert.strictEqual(executionStarts, 1);
    assert.deepStrictEqual(
        rpcLog.find(({ name }) => name === "start_target_search"),
        {
            name: "start_target_search",
            values: {
                p_workflow_run_id: WORKFLOW_ID,
                p_search_request_id: SEARCH_ID
            }
        }
    );
    assert.deepStrictEqual(preparedPayload, {
        owner_user_id: OWNER_ID,
        workflow_run_id: WORKFLOW_ID,
        search_request_id: SEARCH_ID,
        target: {
            name: "Trusted Target",
            current_company: "Trusted Company",
            linkedin_url: "https://www.linkedin.com/in/trusted-target",
            location: "Trusted Location",
            keywords: "fintech",
            company_filter: "OpenAI",
            school_filter: "Stanford"
        },
        normalized_search_key: "trusted-key"
    });

    response = await invoke({ rpcError: { code: "40001" } });
    assert.strictEqual(response.statusCode, 409);
    assert.match(response.body.error_id, /^[0-9a-f-]{36}$/);

    const originalError = console.error;
    let databaseLog;
    console.error = (message, details) => {
        if (message === "Search API database failure") databaseLog = details;
    };
    response = await invoke({ rpcError: {
        code: "23502", message: "null value violates not-null constraint",
        details: "Failing row contains candidate data.", hint: "Inspect cache snapshot."
    } });
    console.error = originalError;
    assert.strictEqual(response.statusCode, 500);
    assert.strictEqual(response.body.code, "DATABASE_ERROR");
    assert.strictEqual(databaseLog.code, "23502");
    assert.strictEqual(databaseLog.message, "null value violates not-null constraint");
    assert.strictEqual(databaseLog.details, "Failing row contains candidate data.");
    assert.strictEqual(databaseLog.hint, "Inspect cache snapshot.");
    assert.strictEqual(databaseLog.error_id, response.body.error_id);

    const failureUpdates = [];
    response = await invoke({ rpcError: { code: "23502", message: "copy failed" }, updateLog: failureUpdates });
    assert.strictEqual(response.statusCode, 500);
    assert.ok(failureUpdates.some((update) => update.table === "workflow_runs" && update.values.status === "failed"));
    assert.ok(failureUpdates.some((update) => update.table === "search_requests" && update.values.status === "failed"));

    assert.deepStrictEqual(cacheDecisionFromRow(rpcRow("cache_hit")), {
        hit: true,
        cacheId: "44444444-4444-4444-8444-444444444444",
        sourceWorkflowRunId: "55555555-5555-4555-8555-555555555555",
        copiedCandidateCount: 12,
        copiedTopCandidateCount: 3
    });
    assert.deepStrictEqual(cacheDecisionFromRow(rpcRow("cache_invalid")), {
        hit: false,
        invalid: true,
        cacheId: null
    });

    function cacheClient(data, error = null) {
        const calls = [];
        const query = {
            select(value) { calls.push(["select", value]); return query; },
            eq(field, value) { calls.push(["eq", field, value]); return query; },
            order(field, value) { calls.push(["order", field, value]); return query; },
            limit(value) { calls.push(["limit", value]); return query; },
            maybeSingle: async () => ({ data, error })
        };
        return { client: { from: table => { calls.push(["from", table]); return query; } }, calls };
    }

    const sharedRow = {
        id: "44444444-4444-4444-8444-444444444444",
        owner_user_id: "99999999-9999-4999-8999-999999999999",
        normalized_search_key: "trusted-key",
        candidate_snapshot: [{ name: "Cached Profile" }],
        expires_at: null,
        source_workflow_run_id: "55555555-5555-4555-8555-555555555555"
    };
    let cacheMock = cacheClient(sharedRow);
    let sharedDecision = await findValidSharedSearchCache(cacheMock.client, "trusted-key", () => Date.now());
    assert.strictEqual(sharedDecision.hit, true);
    assert.deepStrictEqual(sharedDecision.profiles, sharedRow.candidate_snapshot);
    assert.deepStrictEqual(cacheMock.calls.filter(call => call[0] === "eq"), [
        ["eq", "normalized_search_key", "trusted-key"]
    ], "shared cache lookup must not filter by owner_user_id");

    cacheMock = cacheClient({ ...sharedRow, candidate_snapshot: [], expires_at: null });
    assert.strictEqual((await findValidSharedSearchCache(cacheMock.client, "trusted-key")).invalid, true);

    cacheMock = cacheClient({ ...sharedRow, expires_at: "2020-01-01T00:00:00.000Z" });
    assert.strictEqual((await findValidSharedSearchCache(cacheMock.client, "trusted-key")).hit, false);

    cacheMock = cacheClient(null, { code: "TEMPORARY_DATABASE_ERROR", message: "lookup failed" });
    await assert.rejects(
        () => findValidSharedSearchCache(cacheMock.client, "trusted-key"),
        error => error.code === "TEMPORARY_DATABASE_ERROR" && error.message === "lookup failed"
    );

    function cacheWriteClient(existing = null) {
        const calls = [];
        return {
            calls,
            client: {
                from(table) {
                    const query = {
                        select(fields) {
                            calls.push(["select", table, fields]);
                            return query;
                        },
                        eq(field, value) {
                            calls.push(["eq", table, field, value]);
                            return query;
                        },
                        order(field, options) {
                            calls.push(["order", table, field, options]);
                            return query;
                        },
                        limit(value) {
                            calls.push(["limit", table, value]);
                            return query;
                        },
                        maybeSingle: async () => ({ data: existing, error: null }),
                        update(values) {
                            calls.push(["update", table, values]);
                            return query;
                        },
                        insert(values) {
                            calls.push(["insert", table, values]);
                            return query;
                        },
                        single: async () => ({ data: { id: existing?.id || "new-cache-id" }, error: null })
                    };
                    return query;
                }
            }
        };
    }

    const rawProfiles = [{ name: "One" }, { name: "Two" }];
    let writeMock = cacheWriteClient(null);
    let cacheWrite = await upsertSharedSearchCache({
        supabase: writeMock.client,
        normalizedSearchKey: "trusted-key",
        ownerUserId: OWNER_ID,
        sourceWorkflowRunId: WORKFLOW_ID,
        targetName: "Trusted Target",
        profiles: rawProfiles,
        now: () => new Date("2026-07-23T00:00:00.000Z")
    });
    assert.strictEqual(cacheWrite.action, "inserted");
    const insertCall = writeMock.calls.find(call => call[0] === "insert");
    assert.strictEqual(insertCall[2].profile_count, 2);
    assert.strictEqual(insertCall[2].normalized_search_key, "trusted-key");
    assert.strictEqual(insertCall[2].source_workflow_run_id, WORKFLOW_ID);
    assert.deepStrictEqual(insertCall[2].candidate_snapshot, rawProfiles);
    assert.strictEqual(insertCall[2].expires_at, "2026-07-30T00:00:00.000Z");
    assert.strictEqual(insertCall[2].created_at, "2026-07-23T00:00:00.000Z");

    writeMock = cacheWriteClient({ id: "existing-cache-id", created_at: "2026-07-01T00:00:00.000Z" });
    cacheWrite = await upsertSharedSearchCache({
        supabase: writeMock.client,
        normalizedSearchKey: "trusted-key",
        ownerUserId: OWNER_ID,
        sourceWorkflowRunId: WORKFLOW_ID,
        targetName: "Trusted Target",
        profiles: rawProfiles,
        now: () => new Date("2026-07-23T00:00:00.000Z")
    });
    assert.strictEqual(cacheWrite.action, "updated");
    assert.strictEqual(writeMock.calls.filter(call => call[0] === "insert").length, 0);
    const updateCall = writeMock.calls.find(call => call[0] === "update");
    assert.strictEqual(Object.hasOwn(updateCall[2], "created_at"), false);
    await assert.rejects(() => upsertSharedSearchCache({
        supabase: writeMock.client,
        normalizedSearchKey: "trusted-key",
        ownerUserId: OWNER_ID,
        sourceWorkflowRunId: WORKFLOW_ID,
        targetName: "Trusted Target",
        profiles: []
    }), /non-empty raw profile array/);

    const migration = fs.readFileSync(
        path.join(__dirname, "..", "supabase", "migrations", "202607180004_target_search_cache_engine.sql"),
        "utf8"
    );
    assert.match(migration, /sc\.owner_user_id = current_owner/);
    assert.match(migration, /sc\.normalized_search_key = search_record\.normalized_search_key/);
    assert.match(migration, /sc\.expires_at > now\(\)/);
    assert.match(migration, /current_owner, workflow_record\.id/);
    assert.doesNotMatch(migration, /insert into public\.ranked_candidates\s*\(\s*id,/i);
    assert.match(migration, /status = 'completed', cache_hit = true/);
    assert.match(migration, /relationship_evidence, top_candidate_reason/);
    assert.match(migration, /coalesce\(candidate_data -> 'relationship_evidence', '\{\}'::jsonb\)/);
    assert.match(migration, /exception when others then/);

    const repairMigration = fs.readFileSync(
        path.join(__dirname, "..", "supabase", "migrations", "202607180006_repair_target_search_cache_and_recovery.sql"),
        "utf8"
    );
    assert.match(repairMigration, /recover_abandoned_target_searches/);
    assert.match(repairMigration, /interval '5 minutes'/);
    assert.match(repairMigration, /interval '2 hours'/);
    assert.match(repairMigration, /greatest\(sr\.updated_at, wr\.updated_at\)/);
    assert.match(repairMigration, /update public\.search_requests/);
    assert.match(repairMigration, /update public\.workflow_runs/);

    console.log("Search API tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
