const dns = require("dns");

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 530]);
const RESPONSE_PREVIEW_LIMIT = 800;

class N8nDispatchError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "N8nDispatchError";
        this.code = code;
        Object.assign(this, details);
    }
}

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeText(value, limit = 2000) {
    return String(value || "")
        .replace(/https?:\/\/[^\s"'<>]+/gi, match => {
            try {
                const url = new URL(match);
                return `${url.origin}${url.pathname}`;
            } catch {
                return "[redacted-url]";
            }
        })
        .replace(
            /\b(authorization|cookie|password|secret|token)\b(\s*[:=]\s*)([^\s,;}\]]+)/gi,
            "$1$2<redacted>"
        )
        .slice(0, limit);
}

function responsePreview(value) {
    if (value === undefined || value === null) return null;
    const text = typeof value === "string"
        ? value
        : JSON.stringify(value, (key, nestedValue) => (
            /authorization|cookie|password|secret|token/i.test(key)
                ? "<redacted>"
                : nestedValue
        ));
    return sanitizeText(text, RESPONSE_PREVIEW_LIMIT);
}

function sanitizeDestination(url) {
    return {
        protocol: url.protocol,
        hostname: url.hostname,
        pathname: url.pathname
    };
}

function privateProductionHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (["localhost", "host.docker.internal", "::1"].includes(normalized)) return true;
    if (normalized.endsWith(".localhost")) return true;
    if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^169\.254\./.test(normalized) ||
        /^192\.168\./.test(normalized)) return true;
    const match = normalized.match(/^172\.(\d{1,3})\./);
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
    return /^(?:fc|fd|fe80):/i.test(normalized);
}

function resolveWebhookUrl(webhookUrl, { environment = process.env.NODE_ENV } = {}) {
    const normalized = String(webhookUrl || "").trim();
    if (!normalized) {
        throw new N8nDispatchError(
            "N8N_WEBHOOK_URL_MISSING",
            "N8N_EXTRACTION_WEBHOOK_URL is missing."
        );
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(normalized);
    } catch {
        throw new N8nDispatchError(
            "N8N_WEBHOOK_URL_INVALID",
            "N8N_EXTRACTION_WEBHOOK_URL must be a valid absolute URL."
        );
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) {
        throw new N8nDispatchError(
            "N8N_WEBHOOK_URL_INVALID",
            "N8N_EXTRACTION_WEBHOOK_URL must use HTTP or HTTPS."
        );
    }
    if (environment === "production" && parsedUrl.protocol !== "https:") {
        throw new N8nDispatchError(
            "N8N_WEBHOOK_URL_NOT_PUBLIC",
            "N8N_EXTRACTION_WEBHOOK_URL must use HTTPS in production."
        );
    }
    if (environment === "production" && privateProductionHostname(parsedUrl.hostname)) {
        throw new N8nDispatchError(
            "N8N_WEBHOOK_URL_NOT_PUBLIC",
            "N8N_EXTRACTION_WEBHOOK_URL must use a public hostname in production."
        );
    }
    return parsedUrl;
}

function parseResponse(text, contentType) {
    if (!text) return null;
    if (!(contentType || "").includes("application/json")) return text;
    try { return JSON.parse(text); } catch { return text; }
}

function nestedErrorMetadata(error) {
    if (!error) return null;
    const fields = ["name", "message", "code", "errno", "syscall", "hostname", "address", "port"];
    return Object.fromEntries(fields.map(field => [
        field,
        field === "message" ? sanitizeText(error[field]) : error[field] ?? null
    ]));
}

function sanitizeDispatchError(error) {
    return {
        ...nestedErrorMetadata(error),
        stack: error?.stack ? sanitizeText(error.stack) : null,
        cause: nestedErrorMetadata(error?.cause)
    };
}

function classifyDispatchError(error, timeout) {
    if (error instanceof N8nDispatchError) return error.code;
    if (error?.status === 404) return "N8N_WEBHOOK_NOT_FOUND";
    if (error?.status === 401 || error?.status === 403) return "N8N_WEBHOOK_ACCESS_DENIED";
    if (error?.status === 413) return "N8N_WEBHOOK_PAYLOAD_TOO_LARGE";
    if (error?.status === 429) return "N8N_WEBHOOK_RATE_LIMITED";
    if (error?.status >= 500) return "N8N_WEBHOOK_UPSTREAM_ERROR";
    const code = String(error?.cause?.code || error?.code || "").toUpperCase();
    const message = `${error?.message || ""} ${error?.cause?.message || ""}`.toUpperCase();
    if (timeout || /ABORT|TIMEOUT/.test(code) || /TIMED?\s*OUT|TIMEOUT/.test(message)) {
        return "N8N_WEBHOOK_TIMEOUT";
    }
    if (["ENOTFOUND", "EAI_AGAIN"].includes(code) || /GETADDRINFO/.test(message)) {
        return "N8N_WEBHOOK_DNS_FAILURE";
    }
    if (code === "ECONNREFUSED") return "N8N_WEBHOOK_CONNECTION_REFUSED";
    if (code === "ECONNRESET") return "N8N_WEBHOOK_CONNECTION_RESET";
    if (/CERT|TLS|SSL/.test(code) || /CERTIFICATE|TLS|SSL/.test(message)) {
        return "N8N_WEBHOOK_TLS_FAILURE";
    }
    return "N8N_WEBHOOK_TRANSPORT_FAILURE";
}

async function diagnoseDns(hostname, lookup = dns.promises.lookup) {
    try {
        const result = await lookup(hostname);
        return {
            resolved: true,
            address: result?.address || null,
            family: result?.family || null,
            error: null
        };
    } catch (error) {
        return {
            resolved: false,
            address: null,
            family: null,
            error: nestedErrorMetadata(error)
        };
    }
}

async function sendExtractionToN8n({
    webhookUrl,
    webhookSecret = "",
    authorizationToken = "",
    payload,
    timeoutMs = 30000,
    maxRetries = 3,
    environment = process.env.NODE_ENV,
    fetchImpl = globalThis.fetch,
    dnsLookup = dns.promises.lookup,
    logger = console,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
}) {
    const parsedUrl = resolveWebhookUrl(webhookUrl, { environment });
    const destination = sanitizeDestination(parsedUrl);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new N8nDispatchError("N8N_WEBHOOK_PAYLOAD_INVALID", "n8n extraction payload must be an object.");
    }
    if (typeof fetchImpl !== "function") {
        throw new N8nDispatchError("N8N_WEBHOOK_FETCH_UNAVAILABLE", "Fetch is unavailable for n8n dispatch.");
    }

    const ownerUserId = String(payload.owner_user_id || "").trim();
    const workflowRunId = String(payload.workflow_run_id || "").trim();
    const searchRequestId = String(payload.search_request_id || "").trim();
    if (!ownerUserId || !workflowRunId || !searchRequestId) {
        throw new N8nDispatchError(
            "N8N_WEBHOOK_PAYLOAD_INVALID",
            "Owner and workflow identifiers are required for n8n dispatch."
        );
    }

    const idempotencyKey = `warm-path:${ownerUserId}:${workflowRunId}:${searchRequestId}:completed`;
    const serializedPayload = JSON.stringify(payload);
    const attemptsAllowed = positiveInteger(maxRetries, 3);
    const boundedTimeout = positiveInteger(timeoutMs, 30000);
    let lastError;

    void diagnoseDns(parsedUrl.hostname, dnsLookup)
        .then(dnsEvidence => {
            logger.log("[N8N_DISPATCH] reachability", {
                destination,
                dns: dnsEvidence
            });
        })
        .catch(error => {
            logger.warn("[N8N_DISPATCH] reachability diagnostic failed", {
                destination,
                error: sanitizeDispatchError(error)
            });
        });

    for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeoutImpl(() => controller.abort(), boundedTimeout);
        logger.log("[N8N_DISPATCH] started", {
            owner_user_id: ownerUserId,
            workflow_run_id: workflowRunId,
            search_request_id: searchRequestId,
            attempt,
            idempotency_key: idempotencyKey,
            destination,
            timeout_ms: boundedTimeout
        });
        logger.log("[N8N_WEBHOOK_DISPATCH]", {
            workflow_run_id: workflowRunId,
            search_request_id: searchRequestId,
            attempt,
            destination
        });

        try {
            const headers = {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-Idempotency-Key": idempotencyKey,
                "X-Owner-User-Id": ownerUserId,
                "X-Workflow-Run-Id": workflowRunId,
                "X-Search-Request-Id": searchRequestId
            };
            if (webhookSecret) headers["X-Warm-Path-Webhook-Secret"] = webhookSecret;
            if (authorizationToken) headers.Authorization = `Bearer ${authorizationToken}`;

            const response = await fetchImpl(parsedUrl.href, {
                method: "POST",
                headers,
                body: serializedPayload,
                signal: controller.signal,
                redirect: "follow"
            });
            const text = await response.text();
            const contentType = response.headers.get("content-type") || "";
            const body = parseResponse(text, contentType);
            const retryable = TRANSIENT_STATUSES.has(response.status);
            const responseEvidence = {
                status: response.status,
                status_text: response.statusText || "",
                content_type: contentType,
                body_preview: responsePreview(body),
                elapsed_ms: Date.now() - startedAt
            };

            if (!response.ok) {
                const error = new N8nDispatchError(
                    classifyDispatchError({ status: response.status }, false),
                    `n8n request failed with HTTP ${response.status}.`,
                    { status: response.status, responsePreview: responseEvidence.body_preview, retryable, attempt }
                );
                throw error;
            }
            if (!body || typeof body !== "object" || body.accepted !== true) {
                throw new N8nDispatchError(
                    "N8N_WEBHOOK_ACKNOWLEDGEMENT_INVALID",
                    "n8n response did not acknowledge the extraction payload.",
                    {
                        status: response.status,
                        responsePreview: responseEvidence.body_preview,
                        retryable: false,
                        attempt
                    }
                );
            }

            const result = {
                status: response.status,
                body,
                attempt,
                attempts: attempt,
                duration_ms: responseEvidence.elapsed_ms,
                n8n_execution_id: body.execution_id || body.executionId || null,
                idempotency_key: idempotencyKey
            };
            logger.log("[N8N_DISPATCH] success", {
                owner_user_id: ownerUserId,
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                destination,
                ...responseEvidence,
                attempt,
                n8n_execution_id: result.n8n_execution_id
            });
            logger.log("[N8N_WEBHOOK_RESPONSE]", {
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                response_status: response.status,
                accepted: true,
                attempt,
                elapsed_ms: responseEvidence.elapsed_ms
            });
            return result;
        } catch (error) {
            const timeout = error?.name === "AbortError" || controller.signal.aborted;
            const retryable = timeout || error.retryable === true || !error.status;
            const classification = classifyDispatchError(error, timeout);
            if (!(error instanceof N8nDispatchError)) error.code = classification;
            lastError = error;
            Object.assign(lastError, { retryable, attempt, code: error.code || classification });
            logger.error("[N8N_DISPATCH] failed", {
                owner_user_id: ownerUserId,
                workflow_run_id: workflowRunId,
                search_request_id: searchRequestId,
                destination,
                status: error.status || null,
                response_preview: error.responsePreview || null,
                attempt,
                elapsed_ms: Date.now() - startedAt,
                timeout_ms: boundedTimeout,
                classification,
                error: sanitizeDispatchError(error),
                retryable
            });
            if (!retryable || attempt >= attemptsAllowed) break;
            await sleep(attempt * 1000);
        } finally {
            clearTimeoutImpl(timer);
        }
    }

    throw lastError;
}

module.exports = {
    N8nDispatchError,
    TRANSIENT_STATUSES,
    classifyDispatchError,
    diagnoseDns,
    resolveWebhookUrl,
    sanitizeDestination,
    sanitizeDispatchError,
    sendExtractionToN8n
};
