#!/usr/bin/env node
"use strict";

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|x-n8n-api-key|x-idempotency-key|token|secret|password|api[_-]?key|credential)/i;
const REQUIRED_RELATIONSHIP_KEYS = ["same_company", "same_location", "same_school", "same_department", "department_similarity", "years_at_company", "current_employee"];
const BOOLEAN_RELATIONSHIP_KEYS = ["same_company", "same_location", "same_school", "same_department", "current_employee"];
const NUMERIC_RELATIONSHIP_KEYS = ["department_similarity", "years_at_company"];
const EVIDENCE_PATHS = [
    ["relationship_evidence"], ["analysis", "relationship_evidence"], ["ai_analysis", "relationship_evidence"],
    ["profile", "relationship_evidence"], ["json", "relationship_evidence"], ["json", "analysis", "relationship_evidence"],
    ["json", "ai_analysis", "relationship_evidence"], ["json", "profile", "relationship_evidence"]
];
const RELEVANT_NODES = ["Webhook", "Split Profiles", "Normalize Data", "Extract Features", "Seniority Engine", "Decision Power Engine", "Warm Score Engine", "Prepare AI Input", "Temporary Mock AI Analysis", "Final Scoring", "Rank Candidates", "Build Final Report", "Top 3 Summary", "Save Candidates", "Respond to Webhook"];

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitize(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitize(item, seen)]));
}

function normalizeBaseUrl(value) {
    let parsed;
    try { parsed = new URL(String(value)); } catch (_) { throw new Error("N8N_BASE_URL must be a valid HTTP(S) URL."); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("N8N_BASE_URL must use HTTP or HTTPS.");
    if (parsed.username || parsed.password) throw new Error("N8N_BASE_URL must not contain embedded credentials.");
    if (parsed.search || parsed.hash) throw new Error("N8N_BASE_URL must not contain a query string or fragment.");
    return parsed.toString().replace(/\/$/, "");
}

function getConfig(env = process.env) {
    if (!env.N8N_BASE_URL) throw new Error("N8N_BASE_URL is required. Set it in the current shell environment.");
    if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY is required. Set it in the current shell environment.");
    return { baseUrl: normalizeBaseUrl(env.N8N_BASE_URL), apiKey: env.N8N_API_KEY };
}

// Intentionally read-only: this helper always performs GET and cannot mutate n8n state.
async function requestJson({ baseUrl, apiKey, path, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetchImpl(`${baseUrl}${path}`, { method: "GET", headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" }, signal: controller.signal });
        } catch (error) {
            if (error && error.name === "AbortError") throw new Error("n8n API request timed out.");
            throw new Error("n8n API request failed.");
        }
        if (!response.ok) throw new Error(`n8n API request failed: HTTP ${response.status}`);
        try { return await response.json(); } catch (_) { throw new Error("n8n API returned invalid JSON."); }
    } finally { clearTimeout(timer); }
}

function parseArgs(argv) {
    const positional = [], options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith("--")) { positional.push(arg); continue; }
        const equal = arg.indexOf("=");
        const key = arg.slice(2, equal > -1 ? equal : undefined);
        const value = equal > -1 ? arg.slice(equal + 1) : (argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true);
        options[key] = value;
    }
    return { positional, options };
}

function boundedLimit(value, fallback, maximum) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function executionSummary(execution) {
    return Object.fromEntries(["id", "workflowId", "status", "startedAt", "stoppedAt", "finished", "mode", "retryOf", "retrySuccessId"].map((key) => [key, execution?.[key] ?? null]));
}

function getRunData(execution) {
    return execution?.data?.resultData?.runData || execution?.resultData?.runData || execution?.runData || null;
}

function flattenNodeItems(runs) {
    const items = [];
    for (const run of Array.isArray(runs) ? runs : []) {
        for (const branch of Array.isArray(run?.data?.main) ? run.data.main : []) {
            if (Array.isArray(branch)) items.push(...branch);
        }
    }
    return items;
}

function normalizeNodeName(name) { return String(name).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function findNodeName(runData, expected) {
    if (Object.hasOwn(runData, expected)) return expected;
    const normalized = normalizeNodeName(expected);
    let found = Object.keys(runData).find((name) => normalizeNodeName(name) === normalized);
    if (!found && expected === "Temporary Mock AI Analysis") found = Object.keys(runData).find((name) => /mockaianalysis/.test(normalizeNodeName(name)));
    return found || null;
}

function valueAtPath(object, path) {
    let value = object;
    for (const key of path) { if (!isPlainObject(value) || !Object.hasOwn(value, key)) return { found: false }; value = value[key]; }
    return { found: true, value };
}

function classifyEvidence(value, found) {
    if (!found) return "MISSING";
    if (value === null) return "NULL";
    if (!isPlainObject(value)) return "MALFORMED";
    if (!REQUIRED_RELATIONSHIP_KEYS.every((key) => Object.hasOwn(value, key))) return "MALFORMED";
    if (!BOOLEAN_RELATIONSHIP_KEYS.every((key) => typeof value[key] === "boolean")) return "MALFORMED";
    if (!NUMERIC_RELATIONSHIP_KEYS.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))) return "MALFORMED";
    return "PRESENT";
}

function normalizeLinkedIn(value) { return String(value || "").trim().replace(/\/+$/, "").toLowerCase(); }
function candidateIdentity(value) {
    if (!isPlainObject(value)) return { name: "", linkedinUrl: "" };
    return {
        name: String(value.name || value.full_name || value.candidate_name || value.profile?.name || "").trim(),
        linkedinUrl: value.linkedin_url || value.linkedinUrl || value.profile_url || value.url || value.profile?.linkedin_url || ""
    };
}

function matchesCandidate(value, options) {
    const identity = candidateIdentity(value);
    if (options["linkedin-url"]) return normalizeLinkedIn(identity.linkedinUrl) === normalizeLinkedIn(options["linkedin-url"]);
    if (options.candidate) return identity.name.toLowerCase() === String(options.candidate).trim().toLowerCase();
    return true;
}

function collectEvidenceRecords(items, options) {
    const records = [], seen = new WeakSet();
    function visit(value) {
        if (value === null || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        if (isPlainObject(value) && matchesCandidate(value, options)) {
            for (const path of EVIDENCE_PATHS) {
                const result = valueAtPath(value, path);
                if (result.found) { records.push({ candidate: candidateIdentity(value), evidence: result.value, status: classifyEvidence(result.value, true) }); break; }
            }
        }
        for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
    }
    items.forEach(visit);
    return records;
}

function containsValue(value, needle, seen = new WeakSet()) {
    if (value === null || value === undefined) return false;
    if (typeof value !== "object") return String(value).toLowerCase().includes(String(needle).toLowerCase());
    if (seen.has(value)) return false;
    seen.add(value);
    return (Array.isArray(value) ? value : Object.values(value)).some((item) => containsValue(item, needle, seen));
}

function helpText() {
    return `Backend-only, read-only n8n execution inspector. It only sends GET requests.\n\nUsage:\n  node scripts/inspect-n8n-execution.js recent [--limit 10] [--status success] [--workflow-id ID]\n  node scripts/inspect-n8n-execution.js execution <id>\n  node scripts/inspect-n8n-execution.js find --workflow-run-id ID|--search-request-id ID|--owner-user-id ID|--target NAME [--limit 20]\n  node scripts/inspect-n8n-execution.js evidence <id> [--candidate NAME] [--linkedin-url URL]\n\nSecurity:\n  Revoke any exposed key. Supply a fresh key only through the current shell. No .env file is read or modified.\n  Never use a VITE_-prefixed variable for this backend key. Responses are recursively redacted before printing.\n\nPowerShell (placeholders only):\n  $env:N8N_BASE_URL="http://localhost:5678"\n  $env:N8N_API_KEY="<new-private-key>"\n  npm run inspect:n8n -- recent\n\nCMD (placeholders only):\n  set N8N_BASE_URL=http://localhost:5678\n  set N8N_API_KEY=<new-private-key>\n  npm run inspect:n8n -- recent`;
}

async function runCli(argv, dependencies = {}) {
    const write = dependencies.write || ((value) => process.stdout.write(`${value}\n`));
    const { positional, options } = parseArgs(argv);
    const command = positional[0];
    if (!command || command === "help" || command === "--help" || options.help) { write(helpText()); return; }
    const config = getConfig(dependencies.env || process.env);
    const request = (path) => requestJson({ ...config, path, fetchImpl: dependencies.fetchImpl || globalThis.fetch, timeoutMs: dependencies.timeoutMs || 10000 });
    const print = (value) => write(JSON.stringify(sanitize(value), null, 2));

    if (command === "recent") {
        const params = new URLSearchParams({ limit: String(boundedLimit(options.limit, 10, 100)) });
        if (options.status) params.set("status", options.status);
        if (options["workflow-id"]) params.set("workflowId", options["workflow-id"]);
        const response = await request(`/api/v1/executions?${params}`);
        print((Array.isArray(response) ? response : response?.data || []).map(executionSummary)); return;
    }
    if (command === "execution") {
        if (!positional[1]) throw new Error("Execution ID is required.");
        const execution = await request(`/api/v1/executions/${encodeURIComponent(positional[1])}?includeData=true`);
        const runData = getRunData(execution);
        print({ ...executionSummary(execution), nodeRunDataAvailable: Boolean(runData), message: runData ? null : "Execution exists, but node run data is unavailable.", nodes: runData ? Object.entries(runData).map(([name, runs]) => ({ name, status: runs?.at?.(-1)?.executionStatus || (runs?.at?.(-1)?.error ? "error" : "unknown"), outputItems: flattenNodeItems(runs).length })) : [] }); return;
    }
    if (command === "find") {
        const keys = ["workflow-run-id", "search-request-id", "owner-user-id", "target"].filter((key) => options[key]);
        if (keys.length !== 1) throw new Error("Provide exactly one find identifier.");
        const limit = boundedLimit(options.limit, 20, 20);
        const list = await request(`/api/v1/executions?limit=${limit}`);
        const matches = [];
        for (const item of (Array.isArray(list) ? list : list?.data || []).slice(0, limit)) {
            const detail = await request(`/api/v1/executions/${encodeURIComponent(item.id)}?includeData=true`);
            if (containsValue(detail, options[keys[0]])) matches.push(executionSummary(detail));
        }
        print({ searched: keys[0], inspected: Math.min(limit, (list?.data || list || []).length), matches }); return;
    }
    if (command === "evidence") {
        if (!positional[1]) throw new Error("Execution ID is required.");
        const execution = await request(`/api/v1/executions/${encodeURIComponent(positional[1])}?includeData=true`);
        const runData = getRunData(execution);
        if (!runData) { print({ executionId: execution.id || positional[1], message: "Execution exists, but node run data is unavailable.", nodes: RELEVANT_NODES.map((name) => ({ node: name, status: "NODE_NOT_FOUND", outputItems: 0, relationshipEvidence: "NODE_NOT_FOUND" })) }); return; }
        const nodes = RELEVANT_NODES.map((expected) => {
            const actual = findNodeName(runData, expected);
            if (!actual) return { node: expected, executionStatus: null, outputItems: 0, relationshipEvidence: "NODE_NOT_FOUND" };
            const runs = runData[actual], items = flattenNodeItems(runs);
            if (!items.length) return { node: actual, executionStatus: runs?.at?.(-1)?.executionStatus || "unknown", outputItems: 0, relationshipEvidence: "NO_OUTPUT" };
            const records = collectEvidenceRecords(items, options);
            let status = "MISSING";
            if (records.some((record) => record.status === "PRESENT")) status = "PRESENT";
            else if (records.some((record) => record.status === "MALFORMED")) status = "MALFORMED";
            else if (records.some((record) => record.status === "NULL")) status = "NULL";
            const result = { node: actual, executionStatus: runs?.at?.(-1)?.executionStatus || "unknown", outputItems: items.length, relationshipEvidence: status };
            if (records.length) result.matches = records.slice(0, options.candidate || options["linkedin-url"] ? 1 : 30);
            if (normalizeNodeName(actual) === normalizeNodeName("Save Candidates")) result.verification = "Input/output evidence only; Supabase stored row not verified.";
            return result;
        });
        print({ executionId: execution.id || positional[1], nodes }); return;
    }
    throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) runCli(process.argv.slice(2)).catch((error) => { process.stderr.write(`Error: ${error.message}\n`); process.exitCode = 1; });

module.exports = { sanitize, normalizeBaseUrl, getConfig, requestJson, executionSummary, getRunData, classifyEvidence, collectEvidenceRecords, runCli, REQUIRED_RELATIONSHIP_KEYS };
