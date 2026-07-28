require("dotenv").config();

const {
    resolveWebhookUrl,
    sanitizeDestination,
    sanitizeDispatchError,
    sendExtractionToN8n
} = require("../services/n8n-webhook-client");

async function checkN8nWebhook(options = {}) {
    const webhookUrl = options.webhookUrl ?? process.env.N8N_EXTRACTION_WEBHOOK_URL;
    const parsedUrl = resolveWebhookUrl(webhookUrl, {
        environment: options.environment ?? process.env.NODE_ENV
    });
    console.log("[N8N_WEBHOOK_CHECK] destination", sanitizeDestination(parsedUrl));

    return sendExtractionToN8n({
        webhookUrl: parsedUrl.href,
        webhookSecret: options.webhookSecret ?? process.env.N8N_WEBHOOK_SECRET ?? "",
        environment: options.environment ?? process.env.NODE_ENV,
        timeoutMs: options.timeoutMs ?? process.env.N8N_WEBHOOK_TIMEOUT_MS,
        maxRetries: options.maxRetries ?? 1,
        fetchImpl: options.fetchImpl,
        dnsLookup: options.dnsLookup,
        logger: options.logger,
        sleep: options.sleep,
        payload: {
            diagnostic: true,
            source: "local-worker-dispatch-check",
            timestamp: new Date().toISOString(),
            owner_user_id: "diagnostic",
            workflow_run_id: "diagnostic",
            search_request_id: "diagnostic",
            extraction: {
                connections: [],
                candidates: [],
                relationship_evidence: []
            }
        }
    });
}

if (require.main === module) {
    checkN8nWebhook().then(result => {
        console.log("[N8N_WEBHOOK_CHECK] accepted", {
            status: result.status,
            attempt: result.attempt,
            duration_ms: result.duration_ms,
            n8n_execution_id: result.n8n_execution_id
        });
    }).catch(error => {
        console.error("[N8N_WEBHOOK_CHECK] failed", {
            classification: error.code || "N8N_WEBHOOK_CHECK_FAILED",
            error: sanitizeDispatchError(error)
        });
        process.exitCode = 1;
    });
}

module.exports = { checkN8nWebhook };
