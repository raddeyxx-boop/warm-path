"use strict";

const assert = require("assert");
const {
    sanitize, normalizeBaseUrl, getConfig, requestJson, getRunData,
    classifyEvidence, collectEvidenceRecords, runCli
} = require("../scripts/inspect-n8n-execution");

const KEY = "test-api-key";
const ENV = { N8N_BASE_URL: "http://localhost:5678/", N8N_API_KEY: KEY };
const VALID_EVIDENCE = {
    same_company: true, same_location: false, same_school: false,
    same_department: true, department_similarity: 0.75,
    years_at_company: 4.5, current_employee: true
};

function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function execution(id, nodeItems) {
    return {
        id: String(id), workflowId: "workflow-1", status: "success", startedAt: "2026-01-01", stoppedAt: "2026-01-02", finished: true, mode: "webhook",
        data: { resultData: { runData: nodeItems === undefined ? undefined : { "Top 3 Summary": [{ executionStatus: "success", data: { main: [[...nodeItems.map((json) => ({ json }))]] } }] } } }
    };
}

async function capture(argv, fetchImpl, extra = {}) {
    const lines = [];
    await runCli(argv, { env: ENV, fetchImpl, write: (line) => lines.push(line), ...extra });
    return lines.join("\n");
}

async function expectReject(fn, pattern) {
    await assert.rejects(fn, pattern);
}

(async () => {
    assert.throws(() => getConfig({ N8N_API_KEY: KEY }), /N8N_BASE_URL is required/);
    assert.throws(() => getConfig({ N8N_BASE_URL: "http://localhost" }), /N8N_API_KEY is required/);
    assert.throws(() => normalizeBaseUrl("not a url"), /valid HTTP/);
    assert.throws(() => normalizeBaseUrl("http://user:password@localhost:5678"), /embedded credentials/);
    assert.strictEqual(normalizeBaseUrl("http://localhost:5678/"), "http://localhost:5678");

    const calls = [];
    await requestJson({ baseUrl: "http://localhost:5678", apiKey: KEY, path: "/api/v1/executions", fetchImpl: async (url, options) => { calls.push({ url, options }); return jsonResponse({ data: [] }); } });
    assert.strictEqual(calls[0].options.headers["X-N8N-API-KEY"], KEY);
    assert.strictEqual(calls[0].options.method, "GET");

    const redacted = sanitize({ authorization: "a", nested: { apiKey: "b", token_value: "c", safe: 1 }, cookies: [{ "set-cookie": "d" }] });
    assert.strictEqual(redacted.authorization, "[REDACTED]");
    assert.strictEqual(redacted.nested.apiKey, "[REDACTED]");
    assert.strictEqual(redacted.nested.token_value, "[REDACTED]");
    assert.strictEqual(redacted.cookies, "[REDACTED]");
    assert.strictEqual(redacted.nested.safe, 1);

    for (const status of [401, 500]) {
        await expectReject(() => requestJson({ baseUrl: "http://localhost", apiKey: KEY, path: "/api/v1/executions", fetchImpl: async () => jsonResponse({ api_key: KEY }, status) }), new RegExp(`HTTP ${status}`));
    }
    await expectReject(() => requestJson({ baseUrl: "http://localhost", apiKey: KEY, path: "/api/v1/executions", timeoutMs: 1, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("secret"), { name: "AbortError" })))) }), /timed out/);

    const recentOutput = await capture(["recent", "--limit", "5", "--status", "success", "--workflow-id", "workflow-1"], async (url, options) => {
        calls.push({ url, options });
        return jsonResponse({ data: [{ ...execution("1", []), data: { secret: KEY } }] });
    });
    assert.match(recentOutput, /"id": "1"/);
    assert.doesNotMatch(recentOutput, /secret|test-api-key/);
    assert.match(calls.at(-1).url, /limit=5.*status=success.*workflowId=workflow-1/);

    const detailOutput = await capture(["execution", "1"], async () => jsonResponse(execution("1", [{ name: "A" }])));
    assert.match(detailOutput, /"nodeRunDataAvailable": true/);
    assert.match(detailOutput, /"outputItems": 1/);
    const noDataOutput = await capture(["execution", "2"], async () => jsonResponse(execution("2")));
    assert.match(noDataOutput, /node run data is unavailable/);
    assert.strictEqual(getRunData(execution("2")), null);

    const searchCalls = [];
    const searchFetch = async (url, options) => {
        searchCalls.push({ url, options });
        if (/executions\?limit/.test(url)) return jsonResponse({ data: [{ id: "1" }, { id: "2" }] });
        if (/\/1\?/.test(url)) return jsonResponse({ ...execution("1", []), workflow_run_id: "run-123" });
        return jsonResponse({ ...execution("2", []), search_request_id: "search-456" });
    };
    assert.match(await capture(["find", "--workflow-run-id", "run-123"], searchFetch), /"id": "1"/);
    assert.match(await capture(["find", "--search-request-id", "search-456"], searchFetch), /"id": "2"/);
    assert(searchCalls.every((call) => call.options.method === "GET"));

    assert.strictEqual(classifyEvidence(VALID_EVIDENCE, true), "PRESENT");
    assert.strictEqual(classifyEvidence(null, true), "NULL");
    assert.strictEqual(classifyEvidence(undefined, false), "MISSING");
    assert.strictEqual(classifyEvidence({ ...VALID_EVIDENCE, same_company: "yes" }, true), "MALFORMED");
    const profiles = [
        { name: "Sureshkumar Ramasamy", linkedin_url: "https://www.linkedin.com/in/sureshkumar79/", relationship_evidence: VALID_EVIDENCE },
        { name: "Different Person", linkedin_url: "https://linkedin.com/in/different", relationship_evidence: null }
    ];
    assert.strictEqual(collectEvidenceRecords(profiles, { "linkedin-url": "https://www.linkedin.com/in/sureshkumar79" }).length, 1);
    assert.strictEqual(collectEvidenceRecords(profiles, { candidate: "sureshkumar ramasamy" }).length, 1);

    const evidenceOutput = await capture(["evidence", "3", "--candidate", "Sureshkumar Ramasamy"], async (_url, options) => {
        calls.push({ options }); return jsonResponse(execution("3", profiles));
    });
    assert.match(evidenceOutput, /"relationshipEvidence": "PRESENT"/);
    assert.match(evidenceOutput, /"same_company": true/);
    const nullOutput = await capture(["evidence", "3", "--candidate", "Different Person"], async () => jsonResponse(execution("3", profiles)));
    assert.match(nullOutput, /"relationshipEvidence": "NULL"/);
    const missingOutput = await capture(["evidence", "3"], async () => jsonResponse(execution("3", [{ name: "No Evidence" }])));
    assert.match(missingOutput, /"relationshipEvidence": "MISSING"/);
    const malformedOutput = await capture(["evidence", "3"], async () => jsonResponse(execution("3", [{ relationship_evidence: { ...VALID_EVIDENCE, years_at_company: "4" } }])));
    assert.match(malformedOutput, /"relationshipEvidence": "MALFORMED"/);
    assert(calls.every((call) => !call.options || call.options.method === "GET"));
    assert.doesNotMatch([recentOutput, detailOutput, noDataOutput, evidenceOutput].join("\n"), new RegExp(KEY));

    const help = await capture(["--help"], async () => { throw new Error("must not fetch"); });
    assert.match(help, /backend-only, read-only/i);
    assert.match(help, /No \.env file is read or modified/);

    console.log("n8n execution inspector tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
