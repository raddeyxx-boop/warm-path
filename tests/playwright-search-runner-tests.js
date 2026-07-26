const assert = require("assert");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const {
    activeExecutions,
    finalizeExecutionCompleted,
    startTargetSearchExecution,
    waitForPersistedResults
} = require("../services/playwright-search-runner");

const payload = {
    owner_user_id: "33333333-3333-4333-8333-333333333333",
    workflow_run_id: "11111111-1111-4111-8111-111111111111",
    search_request_id: "22222222-2222-4222-8222-222222222222",
    normalized_search_key: "search-key",
    target: {
        name: "Target", current_company: "Company", linkedin_url: "https://www.linkedin.com/in/target",
        location: "Location", keywords: null, company_filter: null, school_filter: null
    }
};

function mockSupabase(updates) {
    return {
        from(table) {
            const query = {
                update(values) { updates.push({ table, values }); return query; },
                eq() { return query; },
                in() { return query; },
                then(resolve) { resolve({ error: null }); }
            };
            return query;
        }
    };
}

function mockSpawn(exitCode, calls, stdout = "") {
    return (...args) => {
        calls.push(args);
        const child = new EventEmitter();
        if (stdout) {
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
        }
        setImmediate(() => {
            if (stdout) {
                child.stdout.end(stdout);
                child.stderr.end();
            }
            child.emit("close", exitCode);
        });
        return child;
    };
}

function mockFinalResult(request = payload, connections = [], candidates = []) {
    return {
        owner_user_id: request.owner_user_id, workflow_run_id: request.workflow_run_id,
        search_request_id: request.search_request_id, extraction_status: "completed",
        target: request.target, target_profile: request.target, connections, candidates,
        relationship_evidence: candidates.map(candidate => candidate.relationship_evidence || {}),
        extraction_summary: {}, started_at: new Date().toISOString(), completed_at: new Date().toISOString()
    };
}

async function run() {
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_ANON_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";

    try {
        const {
            assertTargetProfileMatch,
            normalizeLinkedInProfileUrl,
            validateTargetSearchRequest
        } = await import("../types/target-search-request.ts");
        for (const input of [
            "linkedin.com/in/Ali-elsheik",
            "www.linkedin.com/in/Ali-elsheik/",
            "https://linkedin.com/in/Ali-elsheik/",
            "https://www.linkedin.com/in/Ali-elsheik"
        ]) {
            assert.strictEqual(normalizeLinkedInProfileUrl(input), "https://www.linkedin.com/in/Ali-elsheik");
        }
        assert.throws(() => validateTargetSearchRequest({
            workflow_run_id: payload.workflow_run_id,
            search_request_id: payload.search_request_id,
            target: {}
        }), /target input is missing/i);
        assert.throws(() => assertTargetProfileMatch(
            { name: "Ali Elsheik", linkedin_url: "https://www.linkedin.com/in/Ali-elsheik" },
            { name: "Gurupreet Singh", linkedin_url: "https://www.linkedin.com/in/gurupreet-singh-2344aa2bb" }
        ), /does not match/);

        const successUpdates = [];
        const successCalls = [];
        const dependencies = {
            spawn: mockSpawn(0, successCalls),
            createUserSupabaseClient: () => mockSupabase(successUpdates),
            findValidSharedSearchCache: async () => ({ hit: false, invalid: false, row: null, profiles: [] }),
            readFinalExtractionResult: (_file, expected) => mockFinalResult({ ...payload, ...expected }),
            dispatchCompletedExtraction: async () => {},
            waitForPersistedResults: async () => ({ candidateCount: 1 }),
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
        assert.strictEqual(successCalls[0][2].env.NODE_ENV, "production");
        assert.strictEqual(successCalls[0][2].env.PWDEBUG, undefined);
        assert.strictEqual(successCalls[0][2].env.PWDEBUGIMPL, undefined);
        assert.deepStrictEqual(JSON.parse(successCalls[0][2].env.WARM_PATH_TARGET_JSON), {
            name: "Target", linkedin_name: "Target",
            linkedin_url: "https://www.linkedin.com/in/target",
            url: "https://www.linkedin.com/in/target",
            company: "Company", current_company: "Company", location: "Location",
            keywords: "", company_filter: "", school_filter: ""
        });
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const secondPayload = {
            ...payload,
            workflow_run_id: "66666666-6666-4666-8666-666666666666",
            search_request_id: "77777777-7777-4777-8777-777777777777",
            normalized_search_key: "ali-search-key",
            target: {
                name: "Ali Elsheik", current_company: "Anfal",
                linkedin_url: "linkedin.com/in/Ali-elsheik", location: "KSA",
                keywords: null, company_filter: null, school_filter: null
            }
        };
        const secondCalls = [];
        const second = startTargetSearchExecution(secondPayload, "token", {
            ...dependencies,
            spawn: mockSpawn(0, secondCalls)
        });
        await second.promise;
        const secondTarget = JSON.parse(secondCalls[0][2].env.WARM_PATH_TARGET_JSON);
        assert.strictEqual(secondTarget.name, "Ali Elsheik");
        assert.strictEqual(secondTarget.current_company, "Anfal");
        assert.strictEqual(secondTarget.linkedin_url, "https://www.linkedin.com/in/Ali-elsheik");
        assert.strictEqual(secondTarget.location, "KSA");
        assert.strictEqual(JSON.stringify(secondTarget).includes("Gurupreet Singh"), false);
        assert.strictEqual(JSON.stringify(secondTarget).includes("Indpro AB"), false);
        assert.strictEqual(secondCalls[0][2].env.WORKFLOW_RUN_ID, secondPayload.workflow_run_id);
        assert.strictEqual(secondCalls[0][2].env.SEARCH_REQUEST_ID, secondPayload.search_request_id);

        let clientFailureSpawned = false;
        const clientFailure = startTargetSearchExecution(payload, "token", {
            spawn: () => { clientFailureSpawned = true; },
            findValidSharedSearchCache: async () => ({ hit: false, invalid: false, row: null, profiles: [] }),
            createUserSupabaseClient: () => { throw new Error("client construction failed"); }
        });
        await clientFailure.promise;
        assert.strictEqual(clientFailureSpawned, false);
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const failureUpdates = [];
        let failedCacheWrites = 0;
        const failed = startTargetSearchExecution(payload, "token", {
            spawn: mockSpawn(1, []),
            findValidSharedSearchCache: async () => ({ hit: false, invalid: false, row: null, profiles: [] }),
            upsertSharedSearchCache: async () => { failedCacheWrites += 1; },
            createUserSupabaseClient: () => mockSupabase(failureUpdates)
        });
        await failed.promise;
        assert.ok(failureUpdates.some(update => update.table === "workflow_runs" && update.values.status === "failed"));
        assert.ok(failureUpdates.some(update => update.table === "search_requests" && update.values.status === "failed"));
        assert.strictEqual(failedCacheWrites, 0);
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const authenticationFailureUpdates = [];
        let authenticationFailureCacheWrites = 0;
        let authenticationFailureDispatches = 0;
        const authenticationFailureMessage =
            "Your LinkedIn session is no longer active. Open LinkedIn, sign in again, and retry the search.";
        const authenticationFailureMarker = `__WARM_PATH_ERROR__=${JSON.stringify({
            code: "LINKEDIN_PAGE_CLOSED_DURING_AUTH",
            message: authenticationFailureMessage
        })}\n`;
        const authenticationFailed = startTargetSearchExecution(payload, "token", {
            spawn: mockSpawn(1, [], authenticationFailureMarker),
            findValidSharedSearchCache: async () => ({ hit: false, invalid: false, row: null, profiles: [] }),
            upsertSharedSearchCache: async () => { authenticationFailureCacheWrites += 1; },
            dispatchCompletedExtraction: async () => { authenticationFailureDispatches += 1; },
            createUserSupabaseClient: () => mockSupabase(authenticationFailureUpdates)
        });
        await authenticationFailed.promise;
        assert.ok(authenticationFailureUpdates.some(update =>
            update.table === "search_requests" &&
            update.values.status === "failed" &&
            update.values.error_message === authenticationFailureMessage
        ), "the detailed LinkedIn authentication failure must be persisted");
        assert.strictEqual(authenticationFailureCacheWrites, 0);
        assert.strictEqual(authenticationFailureDispatches, 0);

        const lookupFailureUpdates = [];
        let lookupFailureSpawned = false;
        const lookupFailed = startTargetSearchExecution(payload, "token", {
            spawn: () => { lookupFailureSpawned = true; throw new Error("must not spawn"); },
            createUserSupabaseClient: () => mockSupabase(lookupFailureUpdates),
            findValidSharedSearchCache: async () => {
                const error = new Error("temporary cache lookup failure");
                error.code = "TEMPORARY_DATABASE_ERROR";
                throw error;
            }
        });
        await lookupFailed.promise;
        assert.strictEqual(lookupFailureSpawned, false);
        assert.ok(lookupFailureUpdates.some(update => update.table === "workflow_runs" && update.values.status === "failed"));
        assert.ok(lookupFailureUpdates.some(update => update.table === "search_requests" && update.values.status === "failed"));

        delete process.env.SUPABASE_URL;
        const missingEnvironmentUpdates = [];
        const missing = startTargetSearchExecution(payload, "token", {
            spawn: () => { throw new Error("must not spawn"); },
            findValidSharedSearchCache: async () => ({ hit: false, invalid: false, row: null, profiles: [] }),
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

        const completionUpdates = [];
        await finalizeExecutionCompleted(mockSupabase(completionUpdates), payload);
        assert.ok(completionUpdates.some(update =>
            update.table === "workflow_runs" &&
            update.values.status === "completed" &&
            update.values.progress_percent === 100 &&
            update.values.current_step === "completed" &&
            update.values.completed_at &&
            update.values.finished_at
        ));

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
            findValidSharedSearchCache: async () => ({ hit: false, invalid: false, row: null, profiles: [] }),
            readFinalExtractionResult: () => mockFinalResult(),
            dispatchCompletedExtraction: async () => {},
            waitForPersistedResults: async () => { throw new Error("Timed out waiting for analyzed candidates to be persisted."); },
            finalizeExecutionCompleted: async () => { throw new Error("completion must not run"); }
        });
        await timedOutExecution.promise;
        assert.ok(timeoutUpdates.some(update => update.table === "workflow_runs" && update.values.status === "failed"));
        assert.ok(timeoutUpdates.some(update => update.table === "search_requests" && update.values.status === "failed"));
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const ordering = [];
        let emptyExtractionCacheWrites = 0;
        const ordered = startTargetSearchExecution(payload, "token", {
            spawn: mockSpawn(0, []),
            createUserSupabaseClient: () => mockSupabase([]),
            findValidSharedSearchCache: async () => ({ hit: false, invalid: false, row: null, profiles: [] }),
            readFinalExtractionResult: () => mockFinalResult(),
            upsertSharedSearchCache: async () => { emptyExtractionCacheWrites += 1; },
            dispatchCompletedExtraction: async () => { ordering.push("dispatched"); },
            waitForPersistedResults: async () => { ordering.push("verified"); },
            finalizeExecutionCompleted: async () => { ordering.push("completed"); }
        });
        await ordered.promise;
        assert.deepStrictEqual(ordering, ["dispatched", "verified", "completed"]);
        assert.strictEqual(emptyExtractionCacheWrites, 0);
        assert.strictEqual(activeExecutions.has(payload.workflow_run_id), false);

        const extractedProfiles = [
            { name: "Raw One", linkedin_url: "https://www.linkedin.com/in/raw-one" },
            { name: "Raw Two", linkedin_url: "https://www.linkedin.com/in/raw-two" }
        ];
        const extractedCandidates = [{
            name: "Detailed One", linkedin_url: "https://www.linkedin.com/in/raw-one",
            experience: [], education: [], skills: [], technologies: [],
            relationship_evidence: null
        }];
        const missSpawnCalls = [];
        let cacheWriteInput;
        let missDispatchInput;
        const successfulMiss = startTargetSearchExecution(payload, "token", {
            ...dependencies,
            spawn: mockSpawn(0, missSpawnCalls),
            readFinalExtractionResult: () => mockFinalResult(payload, extractedProfiles, extractedCandidates),
            upsertSharedSearchCache: async input => {
                cacheWriteInput = input;
                return { action: "inserted", id: "cache-id", profileCount: input.profiles.length };
            },
            dispatchCompletedExtraction: async input => { missDispatchInput = input; },
            waitForPersistedResults: async () => ({ candidateCount: 2 }),
            finalizeExecutionCompleted: async () => {}
        });
        await successfulMiss.promise;
        assert.strictEqual(missSpawnCalls.length, 1);
        assert.deepStrictEqual(cacheWriteInput.profiles, extractedCandidates);
        assert.strictEqual(cacheWriteInput.normalizedSearchKey, payload.normalized_search_key);
        assert.strictEqual(cacheWriteInput.sourceWorkflowRunId, payload.workflow_run_id);
        assert.strictEqual(cacheWriteInput.ownerUserId, payload.owner_user_id);
        assert.deepStrictEqual(missDispatchInput.result.connections, extractedProfiles);
        assert.deepStrictEqual(missDispatchInput.result.candidates, extractedCandidates);
        assert.strictEqual(missDispatchInput.cacheHit, false);

        const cacheWriteFailureSpawnCalls = [];
        let dispatchAfterCacheFailure = false;
        let cacheWriteFailureLogged = false;
        const originalLog = console.log;
        console.log = (message, details) => {
            if (message === "Target search execution" && details?.event === "search_cache_write_failed") {
                cacheWriteFailureLogged = true;
            }
        };
        const cacheWriteFailure = startTargetSearchExecution(payload, "token", {
            ...dependencies,
            spawn: mockSpawn(0, cacheWriteFailureSpawnCalls),
            readFinalExtractionResult: () => mockFinalResult(payload, extractedProfiles, extractedCandidates),
            upsertSharedSearchCache: async () => {
                const error = new Error("cache unavailable");
                error.code = "CACHE_WRITE_FAILED";
                throw error;
            },
            dispatchCompletedExtraction: async () => { dispatchAfterCacheFailure = true; },
            waitForPersistedResults: async () => ({ candidateCount: 2 }),
            finalizeExecutionCompleted: async () => {}
        });
        await cacheWriteFailure.promise;
        console.log = originalLog;
        assert.strictEqual(cacheWriteFailureSpawnCalls.length, 1);
        assert.strictEqual(cacheWriteFailureLogged, true);
        assert.strictEqual(dispatchAfterCacheFailure, true);

        const cachedProfile = {
            name: "Shared Candidate",
            linkedin_url: "https://www.linkedin.com/in/shared-candidate",
            experience: [], education: [], skills: [], technologies: [],
            relationship_evidence: {
                same_company: false, same_location: true, same_school: false,
                same_department: false, shared_skills: [], shared_technologies: [],
                experience_overlap: [], education_overlap: [], department_similarity: 0,
                years_at_company: 2, current_employee: true
            }
        };
        const cacheSpawnCalls = [];
        let cachedDispatch;
        const cacheHit = startTargetSearchExecution({
            ...payload,
            owner_user_id: "88888888-8888-4888-8888-888888888888"
        }, "token", {
            ...dependencies,
            spawn: mockSpawn(0, cacheSpawnCalls),
            findValidSharedSearchCache: async () => ({
                hit: true,
                invalid: false,
                row: {
                    id: "99999999-9999-4999-8999-999999999999",
                    source_workflow_run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    owner_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
                },
                profiles: [cachedProfile]
            }),
            dispatchCompletedExtraction: async input => { cachedDispatch = input; },
            waitForPersistedResults: async () => ({ candidateCount: 1 }),
            finalizeExecutionCompleted: async () => {}
        });
        await cacheHit.promise;
        assert.strictEqual(cacheSpawnCalls.length, 0, "cache hit returns before Playwright spawn");
        assert.strictEqual(cachedDispatch.cacheHit, true);
        assert.strictEqual(cachedDispatch.result.owner_user_id, "88888888-8888-4888-8888-888888888888");
        assert.strictEqual(cachedDispatch.result.workflow_run_id, payload.workflow_run_id);
        assert.strictEqual(cachedDispatch.result.search_request_id, payload.search_request_id);
        assert.notStrictEqual(cachedDispatch.result.workflow_run_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        assert.deepStrictEqual(cachedDispatch.result.connections, [cachedProfile]);
        assert.deepStrictEqual(cachedDispatch.result.candidates, [cachedProfile]);
        assert.notStrictEqual(cachedDispatch.result.connections, cachedDispatch.result.candidates);

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
