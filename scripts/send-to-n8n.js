const fs = require("fs");
const path = require("path");

const {
    serializeFinalProfiles,
    validateRelationshipEvidence
} = require("../utils/FinalProfileSerializer");
const { sendExtractionToN8n } = require("../services/n8n-webhook-client");
const { createServiceSupabaseClient } = require("../services/supabase-server");

const DATA_DIR = path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(__dirname, "..", "data"));
const filePath = path.join(DATA_DIR, "mutual-details-classified.json");

const targetPath = path.join(DATA_DIR, "target.json");
const connectionsPath = path.join(DATA_DIR, "mutuals.json");

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) {
        return;
    }

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const separator = trimmed.indexOf("=");

        if (separator === -1) {
            continue;
        }

        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();

        if (!key || process.env[key] !== undefined) {
            continue;
        }

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

function loadLocalEnv() {
    const root = path.join(__dirname, "..");

    [
        path.join(root, ".env.local"),
        path.join(root, ".env"),
        path.join(root, "dashboard", ".env.local"),
        path.join(root, "dashboard", ".env")
    ].forEach(loadEnvFile);
}

loadLocalEnv();

function getWebhookUrl() {
    return process.env.N8N_EXTRACTION_WEBHOOK_URL || "";
}

function getWebhookTimeoutMs() {
    const configured = Number(process.env.N8N_WEBHOOK_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : 30000;
}

function parseCliArgs(argv) {
    const args = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (!arg.startsWith("--")) {
            continue;
        }

        const argBody = arg.slice(2);
        const separator = argBody.indexOf("=");
        const rawKey = separator === -1 ? argBody : argBody.slice(0, separator);
        const inlineValue = separator === -1 ? undefined : argBody.slice(separator + 1);
        const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const nextValue = argv[index + 1];

        if (inlineValue !== undefined) {
            args[key] = inlineValue;
            continue;
        }

        if (nextValue && !nextValue.startsWith("--")) {
            args[key] = nextValue;
            index += 1;
        }
    }

    return args;
}

function createMissingAuthError() {
    return new Error(
        "Missing n8n ownership context. Set OWNER_USER_ID, WORKFLOW_RUN_ID, and " +
        "SEARCH_REQUEST_ID before retrying a completed extraction."
    );
}

async function promptForCliValue(label) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return "";
    }

    const readline = require("readline/promises");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        return (await rl.question(label)).trim();
    } finally {
        rl.close();
    }
}

async function resolveOwnerContext() {
    const cliArgs = parseCliArgs(process.argv.slice(2));
    let ownerUserId = cliArgs.ownerUserId || process.env.OWNER_USER_ID || "";

    if (require.main === module) {
        if (!ownerUserId) {
            ownerUserId = await promptForCliValue(
                "Supabase owner_user_id for this run: "
            );
        }

    }

    if (!ownerUserId) {
        throw createMissingAuthError();
    }

    return { ownerUserId };
}

function readRequiredJson(filePathToRead, label) {
    if (!fs.existsSync(filePathToRead)) {
        throw new Error(label + " not found.");
    }

    return JSON.parse(fs.readFileSync(filePathToRead, "utf8"));
}

function parseResponseBody(text, contentType) {
    if (!contentType.includes("application/json") || !text) {
        return text;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function validateN8NPayloadContext({ ownerUserId, workflowRunId, searchRequestId, target }) {
    if (!ownerUserId) throw new Error("OWNER_USER_ID is missing.");
    if (!workflowRunId) throw new Error("WORKFLOW_RUN_ID is missing.");
    if (!searchRequestId) throw new Error("SEARCH_REQUEST_ID is missing.");
    if (!target || typeof target !== "object" || Array.isArray(target)) {
        throw new Error("Target input is missing from the n8n payload.");
    }
    if (!String(target.name || "").trim()) {
        throw new Error("Target name is missing from the n8n payload.");
    }
}

function buildFinalExtractionPayload({ ownerUserId, workflowRunId, searchRequestId, target, profiles, connections, searchHash }) {
    validateN8NPayloadContext({ ownerUserId, workflowRunId, searchRequestId, target });
    if (!Array.isArray(profiles)) throw new Error("Final candidates must be an array.");
    if (!Array.isArray(connections)) throw new Error("Final connections must be an array.");
    validateRelationshipEvidence(profiles);
    const serializedProfiles = serializeFinalProfiles(profiles);
    validateRelationshipEvidence(serializedProfiles);

    const completedAt = new Date().toISOString();
    const startedAt = target.createdAt || completedAt;
    const startedTime = Date.parse(startedAt);
    const completedTime = Date.parse(completedAt);
    const idempotencyKey = `${workflowRunId}:${searchRequestId}:extraction_completed`;
    const finalReport = {
        target,
        mutual_connections: serializedProfiles,
        owner_user_id: ownerUserId,
        workflow_run_id: workflowRunId,
        search_request_id: searchRequestId,
        search_hash: searchHash || null,
        progress: { step: "ai_analysis", profiles_processed: serializedProfiles.length }
    };

    return {
        event: "warm_path.extraction_completed",
        event_version: "1.0",
        sent_at: completedAt,
        workflow_run_id: workflowRunId,
        search_request_id: searchRequestId,
        owner_user_id: ownerUserId,
        target: {
            name: target.name,
            linkedin_url: target.linkedin_url || target.url || null,
            canonical_linkedin_url: target.url || target.linkedin_url || null,
            current_company: target.current_company || target.company || null,
            location: target.location || null,
            profile: target
        },
        extraction: {
            target_profile: target,
            connections,
            candidates: serializedProfiles,
            relationship_evidence: serializedProfiles.map(profile => profile.relationship_evidence),
            summary: {
                status: "completed",
                connection_count: connections.length,
                candidate_count: serializedProfiles.length
            },
            final_report: finalReport
        },
        metadata: {
            source: "warm-path-playwright",
            environment: process.env.NODE_ENV || "development",
            execution_started_at: startedAt,
            execution_completed_at: completedAt,
            execution_duration_ms: Number.isFinite(startedTime) && Number.isFinite(completedTime)
                ? Math.max(0, completedTime - startedTime)
                : 0,
            final_extraction_status: "completed",
            idempotency_key: idempotencyKey
        },
        ...finalReport
    };
}

async function updateDispatchStatus(client, ownerUserId, workflowRunId, values) {
    const { error } = await client.from("workflow_runs").update(values)
        .eq("id", workflowRunId).eq("owner_user_id", ownerUserId);
    if (!error) return true;
    if (error.code === "PGRST204") {
        console.warn("n8n dispatch columns are unavailable; apply the n8n dispatch status migration.", {
            workflow_run_id: workflowRunId
        });
        return false;
    }
    throw error;
}

async function sendToN8N() {
    const { ownerUserId } = await resolveOwnerContext();
    const webhookUrl = getWebhookUrl();
    const rawProfiles = readRequiredJson(filePath, "mutual-details-classified.json");
    if (!Array.isArray(rawProfiles)) throw new Error("mutual-details-classified.json must contain an array.");
    const profiles = serializeFinalProfiles(rawProfiles);
    const target = readRequiredJson(targetPath, "target.json");
    const connections = readRequiredJson(connectionsPath, "mutuals.json");
    const workflowRunId = process.env.WORKFLOW_RUN_ID || "";
    const searchRequestId = process.env.SEARCH_REQUEST_ID || "";
    const payload = buildFinalExtractionPayload({
        ownerUserId, workflowRunId, searchRequestId, target, profiles, connections,
        searchHash: process.env.SEARCH_HASH || null
    });
    const serializedPayload = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(serializedPayload, "utf8");
    console.log("[N8N_PAYLOAD_READY]", {
        workflow_run_id: workflowRunId,
        search_request_id: searchRequestId,
        target_name: target.name,
        connection_count: connections.length,
        candidate_count: profiles.length,
        payload_bytes: payloadBytes
    });
    const client = createServiceSupabaseClient();
    let attempts = 0;
    await updateDispatchStatus(client, ownerUserId, workflowRunId, {
        n8n_dispatch_status: "dispatching", n8n_dispatch_attempts: 0,
        n8n_last_error: null
    }).catch(statusError => console.error("Failed to persist n8n dispatch start; continuing with saved extraction", {
        workflow_run_id: workflowRunId, message: statusError.message
    }));
    try {
        const result = await sendExtractionToN8n({
            webhookUrl,
            webhookSecret: process.env.N8N_WEBHOOK_SECRET || "",
            payload,
            timeoutMs: getWebhookTimeoutMs(),
            maxRetries: Number(process.env.N8N_WEBHOOK_MAX_RETRIES) || 3
        });
        attempts = result.attempts;
        await updateDispatchStatus(client, ownerUserId, workflowRunId, {
            n8n_dispatch_status: "succeeded",
            n8n_dispatch_attempts: attempts,
            n8n_dispatched_at: new Date().toISOString(),
            n8n_response_status: result.status,
            n8n_execution_id: result.n8n_execution_id,
            n8n_last_error: null
        }).catch(statusError => console.error("n8n dispatch succeeded but status persistence failed", {
            workflow_run_id: workflowRunId, n8n_execution_id: result.n8n_execution_id,
            message: statusError.message
        }));
        return result;
    } catch (error) {
        attempts = error.attempt || attempts;
        await updateDispatchStatus(client, ownerUserId, workflowRunId, {
            n8n_dispatch_status: "failed",
            n8n_dispatch_attempts: attempts,
            n8n_response_status: error.status || null,
            n8n_last_error: String(error.message || "n8n dispatch failed").slice(0, 500)
        }).catch(statusError => console.error("Failed to persist n8n dispatch failure", {
            workflow_run_id: workflowRunId, message: statusError.message
        }));
        throw error;
    }
}

if (require.main === module) {
    sendToN8N().catch(error => {
        console.error("send-to-n8n failed", {
            name: error?.name, message: error?.message, code: error?.code,
            status: error?.status, statusText: error?.statusText,
            cause: error?.cause, responseBody: error?.responseBody, stack: error?.stack
        });
        process.exitCode = 1;
    });
}

module.exports = {
    buildFinalExtractionPayload,
    sendToN8N,
    updateDispatchStatus,
    validateN8NPayloadContext,
    validateRelationshipEvidence
};
