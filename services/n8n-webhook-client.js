const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseResponse(text, contentType) {
    if (!text) return null;
    if (!(contentType || "").includes("application/json")) return text;
    try { return JSON.parse(text); } catch (error) { return text; }
}

async function sendExtractionToN8n({
    webhookUrl,
    webhookSecret = "",
    authorizationToken = "",
    payload,
    timeoutMs = 30000,
    maxRetries = 3,
    fetchImpl = globalThis.fetch,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
}) {
    if (!webhookUrl) throw new Error("N8N_EXTRACTION_WEBHOOK_URL is missing.");
    let parsedUrl;
    try {
        parsedUrl = new URL(webhookUrl);
        if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("unsupported protocol");
    } catch (error) {
        throw new Error(`N8N_EXTRACTION_WEBHOOK_URL is invalid: ${error.message}`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("n8n extraction payload must be an object.");
    }
    if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable for n8n dispatch.");

    const ownerUserId = String(payload.owner_user_id || "").trim();
    const workflowRunId = String(payload.workflow_run_id || "").trim();
    const searchRequestId = String(payload.search_request_id || "").trim();
    if (!ownerUserId || !workflowRunId || !searchRequestId) {
        throw new Error("Owner and workflow identifiers are required for n8n dispatch.");
    }

    const idempotencyKey = `warm-path:${ownerUserId}:${workflowRunId}:${searchRequestId}:completed`;
    const serializedPayload = JSON.stringify(payload);
    const attemptsAllowed = positiveInteger(maxRetries, 3);
    const boundedTimeout = positiveInteger(timeoutMs, 30000);
    let lastError;

    for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), boundedTimeout);
        console.log("[N8N_DISPATCH] started", { owner_user_id: ownerUserId, workflow_run_id: workflowRunId, search_request_id: searchRequestId, attempt, idempotency_key: idempotencyKey });

        try {
            const headers = {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-Idempotency-Key": idempotencyKey
            };
            headers["X-Owner-User-Id"] = ownerUserId;
            headers["X-Workflow-Run-Id"] = workflowRunId;
            headers["X-Search-Request-Id"] = searchRequestId;
            if (webhookSecret) headers["X-Warm-Path-Webhook-Secret"] = webhookSecret;
            if (authorizationToken) headers.Authorization = `Bearer ${authorizationToken}`;

            const response = await fetchImpl(parsedUrl.href, {
                method: "POST", headers, body: serializedPayload, signal: controller.signal
            });
            const text = await response.text();
            const body = parseResponse(text, response.headers.get("content-type") || "");
            const retryable = TRANSIENT_STATUSES.has(response.status);

            if (!response.ok) {
                const error = new Error(`n8n request failed with HTTP ${response.status}.`);
                Object.assign(error, { status: response.status, responseBody: body, retryable, attempt });
                throw error;
            }
            if (!body || typeof body !== "object" || body.accepted !== true) {
                const error = new Error("n8n response did not acknowledge the extraction payload.");
                Object.assign(error, { status: response.status, responseBody: body, retryable: false, attempt });
                throw error;
            }

            const result = {
                status: response.status,
                body,
                attempt,
                attempts: attempt,
                duration_ms: Date.now() - startedAt,
                n8n_execution_id: body.execution_id || body.executionId || null,
                idempotency_key: idempotencyKey
            };
            console.log("[N8N_DISPATCH] success", {
                owner_user_id: ownerUserId, workflow_run_id: workflowRunId, search_request_id: searchRequestId,
                status: result.status, attempt, duration_ms: result.duration_ms,
                n8n_execution_id: result.n8n_execution_id
            });
            return result;
        } catch (error) {
            const timeout = error?.name === "AbortError";
            const retryable = timeout || error.retryable === true || !error.status;
            lastError = error;
            Object.assign(lastError, { retryable, attempt });
            console.error("[N8N_DISPATCH] failed", {
                owner_user_id: ownerUserId, workflow_run_id: workflowRunId, search_request_id: searchRequestId,
                status: error.status || null, error: error.message, attempt, retryable
            });
            if (!retryable || attempt >= attemptsAllowed) break;
            await sleep(attempt * 1000);
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError;
}

module.exports = { TRANSIENT_STATUSES, sendExtractionToN8n };
