const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    buildExecutionPayload,
    createStartSearchHandler,
    validRequestBody
} = require("../services/search-api");
const { cacheDecisionFromRow } = require("../services/search-cache");

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

function rpcRow(resultCode = "cache_miss") {
    return {
        result_code: resultCode,
        owner_user_id: OWNER_ID,
        workflow_run_id: WORKFLOW_ID,
        search_request_id: SEARCH_ID,
        target_name: "Trusted Target",
        current_company: "Trusted Company",
        linkedin_name: "Trusted LinkedIn Name",
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

function mockClient({ authError = null, resultCode = "cache_miss", rpcError = null } = {}) {
    const updateQuery = {
        update() { return this; },
        eq() { return this; },
        then(resolve) { resolve({ error: null }); }
    };
    return {
        auth: {
            getUser: async () => ({
                data: authError ? null : { user: { id: OWNER_ID } },
                error: authError
            })
        },
        rpc: async () => ({ data: rpcError ? null : [rpcRow(resultCode)], error: rpcError }),
        from: () => updateQuery
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
    response = await invoke({
        resultCode: "cache_hit",
        startTargetSearchExecution: () => { executionStarts += 1; return { started: true, alreadyExecuting: false }; }
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.cache_hit, true);
    assert.strictEqual(response.body.status, "completed");
    assert.strictEqual(response.body.copied_candidate_count, 12);
    assert.strictEqual(executionStarts, 0);

    let preparedPayload;
    response = await invoke({
        resultCode: "cache_miss",
        prepareExecution: row => {
            preparedPayload = buildExecutionPayload(row);
            return preparedPayload;
        },
        startTargetSearchExecution: () => { executionStarts += 1; return { started: true, alreadyExecuting: false }; }
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, "running");
    assert.strictEqual(response.body.cache_hit, false);
    assert.strictEqual(response.body.next_action, "playwright_required");
    assert.strictEqual(executionStarts, 1);
    assert.deepStrictEqual(preparedPayload, {
        owner_user_id: OWNER_ID,
        workflow_run_id: WORKFLOW_ID,
        search_request_id: SEARCH_ID,
        target: {
            target_name: "Trusted Target",
            current_company: "Trusted Company",
            linkedin_name: "Trusted LinkedIn Name",
            location: "Trusted Location"
        },
        filters: {
            keywords: "fintech",
            company_filter: "OpenAI",
            school_filter: "Stanford"
        },
        normalized_search_key: "trusted-key"
    });

    response = await invoke({ rpcError: { code: "40001" } });
    assert.strictEqual(response.statusCode, 409);

    response = await invoke({ resultCode: "cache_invalid" });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.cache_hit, false);

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

    console.log("Search API tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
