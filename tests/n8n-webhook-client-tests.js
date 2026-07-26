const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { sendExtractionToN8n } = require("../services/n8n-webhook-client");
const { buildWebhookPayload } = require("../services/n8n-dispatch-service");
const { buildFinalExtractionPayload, validateRelationshipEvidence } = require("../scripts/send-to-n8n");

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify(body)
    };
}

function basePayload() {
    return {
        event: "warm_path.extraction.completed",
        owner_user_id: "owner",
        workflow_run_id: "workflow",
        search_request_id: "search",
        target: { name: "Gowri N S" },
        extraction: { connections: [], candidates: [] },
        metadata: {}
    };
}

async function run() {
    const retryScript = fs.readFileSync(path.join(__dirname, "..", "scripts", "send-to-n8n.js"), "utf8");
    assert.match(retryScript, /createServiceSupabaseClient/);
    assert.match(retryScript, /process\.env\.N8N_EXTRACTION_WEBHOOK_URL/);
    assert.doesNotMatch(retryScript, /createUserSupabaseClient|SUPABASE_ACCESS_TOKEN|authorizationToken:\s*accessToken|process\.env\.N8N_WEBHOOK_URL/);
    assert.doesNotMatch(retryScript, /startBrowser|require\(["']playwright["']\)|scripts\/login|linkedin\.com/i);

    const calls = [];
    const success = await sendExtractionToN8n({
        webhookUrl: "https://n8n.example.test/webhook/warm-path",
        webhookSecret: "secret",
        authorizationToken: "token",
        payload: basePayload(),
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return response(200, { accepted: true, execution_id: "n8n-test-123" });
        }
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.method, "POST");
    assert.strictEqual(calls[0].options.headers["X-Warm-Path-Webhook-Secret"], "secret");
    assert.strictEqual(calls[0].options.headers["X-Idempotency-Key"], "warm-path:owner:workflow:search:completed");
    assert.strictEqual(calls[0].options.headers["X-Owner-User-Id"], "owner");
    assert.strictEqual(success.n8n_execution_id, "n8n-test-123");

    const payload = buildFinalExtractionPayload({
        ownerUserId: "owner", workflowRunId: "workflow", searchRequestId: "search",
        target: { name: "Gowri N S", linkedin_url: "https://www.linkedin.com/in/gowri-n-s" },
        profiles: [{ name: "Candidate", relationship_evidence: {
            same_company: true, same_location: true, same_school: false,
            same_department: false, department_similarity: 0.8,
            shared_skills: [], shared_technologies: [], experience_overlap: [],
            education_overlap: [], years_at_company: 19.3, current_employee: true
        } }],
        connections: [{ name: "Connection" }], searchHash: "hash"
    });
    assert.strictEqual(payload.target.name, "Gowri N S");
    assert.strictEqual(payload.extraction.connections.length, 1);
    assert.strictEqual(payload.extraction.candidates.length, 1);
    assert.strictEqual(payload.extraction.relationship_evidence.length, 1);
    assert.deepStrictEqual(payload.extraction.relationship_evidence[0], {
        same_company: true, same_location: true, same_school: false,
        same_department: false, shared_skills: [], shared_technologies: [],
        experience_overlap: [], education_overlap: [], department_similarity: 0.8,
        years_at_company: 19.3, current_employee: true
    });
    assert.deepStrictEqual(
        Object.keys(payload.extraction.candidates[0].relationship_evidence),
        ["same_company", "same_location", "same_school", "same_department",
            "shared_skills", "shared_technologies", "experience_overlap", "education_overlap",
            "department_similarity", "years_at_company", "current_employee"]
    );
    assert.throws(() => validateRelationshipEvidence([{
        name: "Malformed Candidate",
        relationship_evidence: {
            same_company: false, same_location: false, same_school: false,
            same_department: false, department_similarity: 0, years_at_company: 0
        }
    }]), /Invalid relationship_evidence for candidate "Malformed Candidate": missing shared_skills/);
    assert.throws(() => buildFinalExtractionPayload({
        ownerUserId: "owner", workflowRunId: "workflow", searchRequestId: "search",
        target: { name: "Gowri N S" }, connections: [],
        profiles: [{
            name: "Malformed Candidate",
            relationship_evidence: {
                same_company: false, same_location: false, same_school: false,
                same_department: false, shared_skills: [], shared_technologies: [],
                experience_overlap: [], education_overlap: [], department_similarity: 0, years_at_company: 0
            }
        }]
    }), /Invalid relationship_evidence for candidate "Malformed Candidate": missing current_employee/);

    const serviceResult = {
        owner_user_id: "owner", workflow_run_id: "workflow", search_request_id: "search",
        target: { name: "Gowri N S" }, target_profile: { name: "Gowri N S" },
        connections: [{ name: "Raw Mutual" }], candidates: payload.extraction.candidates,
        relationship_evidence: payload.extraction.relationship_evidence,
        extraction_summary: { connection_count: 1, candidate_count: 1 }, extraction_status: "completed",
        started_at: "2026-07-22T00:00:00.000Z", completed_at: "2026-07-22T00:01:00.000Z"
    };
    const servicePayload = buildWebhookPayload(serviceResult, "hash");
    assert.deepStrictEqual(servicePayload.extraction.candidates[0].relationship_evidence,
        payload.extraction.candidates[0].relationship_evidence);
    assert.strictEqual(servicePayload.extraction.candidates[0].name, "Candidate");
    assert.notStrictEqual(servicePayload.extraction.candidates, servicePayload.connections);
    assert.strictEqual(servicePayload.extraction.summary.connection_count, 1);
    assert.strictEqual(servicePayload.extraction.summary.candidate_count, 1);
    assert.throws(() => buildWebhookPayload({
        ...serviceResult,
        connections: serviceResult.candidates
    }, "hash"), /connections and candidates reference the same array/);
    const cachedProfiles = payload.extraction.candidates.map(candidate => ({
        ...candidate, technologies: ["TypeScript"]
    }));
    const cachedServicePayload = buildWebhookPayload({
        ...serviceResult,
        connections: [...cachedProfiles],
        candidates: [...cachedProfiles],
        relationship_evidence: cachedProfiles.map(candidate => candidate.relationship_evidence)
    }, "hash", {
        cacheHit: true,
        cacheId: "cache-id"
    });
    assert.strictEqual(cachedServicePayload.owner_user_id, "owner");
    assert.strictEqual(cachedServicePayload.workflow_run_id, "workflow");
    assert.strictEqual(cachedServicePayload.search_request_id, "search");
    assert.strictEqual(cachedServicePayload.normalized_search_key, "hash");
    assert.strictEqual(cachedServicePayload.cache_hit, true);
    assert.strictEqual(cachedServicePayload.cache_id, "cache-id");
    assert.strictEqual(cachedServicePayload.profiles.length, 1);
    assert.strictEqual(cachedServicePayload.extraction.candidates.length, 1);
    assert.strictEqual(cachedServicePayload.extraction.connections.length, 1);
    assert.notStrictEqual(cachedServicePayload.extraction.candidates, cachedServicePayload.profiles);
    assert.strictEqual(cachedServicePayload.extraction.connections, cachedServicePayload.profiles);
    const splitProfiles = body => {
        const profiles = body.extraction?.candidates;
        if (!Array.isArray(profiles)) throw new Error("Expected body.extraction.candidates to be an array.");
        return profiles.map((profile, index) => ({ json: { profile_id: index + 1, target: body.target, ...profile } }));
    };
    const splitItems = splitProfiles(cachedServicePayload);
    assert.strictEqual(splitItems.length, 1);
    assert.strictEqual(splitItems[0].json.name, "Candidate");
    assert.deepStrictEqual(splitItems[0].json.technologies, ["TypeScript"]);
    assert.throws(() => buildWebhookPayload({
        ...serviceResult,
        candidates: [{ ...serviceResult.candidates[0], relationship_evidence: {
            ...serviceResult.candidates[0].relationship_evidence, current_employee: undefined
        } }]
    }, "hash"), /current_employee must be a boolean/);
    assert.strictEqual(payload.extraction.final_report.mutual_connections.length, 1);

    const retryKeys = [];
    let retryCalls = 0;
    const retryResult = await sendExtractionToN8n({
        webhookUrl: "https://n8n.example.test/webhook/warm-path",
        payload: basePayload(),
        sleep: async () => {},
        fetchImpl: async (_url, options) => {
            retryCalls += 1;
            retryKeys.push(options.headers["X-Idempotency-Key"]);
            return retryCalls < 3
                ? response(503, { accepted: false })
                : response(200, { accepted: true, execution_id: "retry-success" });
        }
    });
    assert.strictEqual(retryResult.attempts, 3);
    assert.deepStrictEqual(new Set(retryKeys).size, 1);

    let permanentCalls = 0;
    await assert.rejects(() => sendExtractionToN8n({
        webhookUrl: "https://n8n.example.test/webhook/warm-path",
        payload: basePayload(),
        fetchImpl: async () => {
            permanentCalls += 1;
            return response(401, { accepted: false });
        }
    }), /HTTP 401/);
    assert.strictEqual(permanentCalls, 1);

    let timeoutCalls = 0;
    await assert.rejects(() => sendExtractionToN8n({
        webhookUrl: "https://n8n.example.test/webhook/warm-path",
        payload: basePayload(), timeoutMs: 1, maxRetries: 2,
        sleep: async () => {},
        fetchImpl: async (_url, options) => {
            timeoutCalls += 1;
            return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }));
        }
    }), /aborted/);
    assert.strictEqual(timeoutCalls, 2);

    let missingUrlCalls = 0;
    await assert.rejects(() => sendExtractionToN8n({
        webhookUrl: "", payload: basePayload(),
        fetchImpl: async () => { missingUrlCalls += 1; }
    }), /N8N_EXTRACTION_WEBHOOK_URL is missing/);
    assert.strictEqual(missingUrlCalls, 0);

    console.log("n8n webhook client tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
