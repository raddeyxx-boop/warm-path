const fs = require("fs");
const path = require("path");

const {
    serializeFinalProfiles
} = require("../utils/FinalProfileSerializer");

const DATA_DIR = path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(__dirname, "..", "data"));
const filePath = path.join(DATA_DIR, "mutual-details-classified.json");

const targetPath = path.join(DATA_DIR, "target.json");

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
    return process.env.N8N_WEBHOOK_URL ||
        "http://localhost:5678/webhook/warm-path";
}

function getWebhookTimeoutMs() {
    return Number(process.env.N8N_WEBHOOK_TIMEOUT_MS || 30000);
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
        "Missing n8n ownership auth. Run through POST /run from the logged-in app, " +
        "or set OWNER_USER_ID and SUPABASE_ACCESS_TOKEN before running this script directly."
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
    let accessToken = cliArgs.accessToken || process.env.SUPABASE_ACCESS_TOKEN || "";

    if (require.main === module) {
        if (!ownerUserId) {
            ownerUserId = await promptForCliValue(
                "Supabase owner_user_id for this run: "
            );
        }

        if (!accessToken) {
            accessToken = await promptForCliValue(
                "Supabase access token for Authorization header: "
            );
        }
    }

    if (!ownerUserId || !accessToken) {
        throw createMissingAuthError();
    }

    return {
        ownerUserId,
        accessToken
    };
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

async function sendToN8N() {
    const { ownerUserId, accessToken } = await resolveOwnerContext();
    const startedAt = Date.now();

    const profiles = serializeFinalProfiles(readRequiredJson(
        filePath,
        "mutual-details-classified.json"
    ));
    const target = readRequiredJson(targetPath, "target.json");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getWebhookTimeoutMs());

    console.log("n8n delivery", {
        event: "started",
        workflow_run_id: process.env.WORKFLOW_RUN_ID || null,
        search_request_id: process.env.SEARCH_REQUEST_ID || null,
        owner_user_id: ownerUserId,
        profile_count: profiles.length
    });

    try {
        const response = await fetch(getWebhookUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                target,
                mutual_connections: profiles,
                owner_user_id: ownerUserId,
                workflow_run_id: process.env.WORKFLOW_RUN_ID || null,
                search_request_id: process.env.SEARCH_REQUEST_ID || null,
                search_hash: process.env.SEARCH_HASH || null,
                progress: {
                    step: "ai_analysis",
                    profiles_processed: profiles.length
                }
            }),
            signal: controller.signal
        });
        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();
        const body = parseResponseBody(text, contentType);

        console.log("n8n delivery", {
            event: "response_received",
            workflow_run_id: process.env.WORKFLOW_RUN_ID || null,
            search_request_id: process.env.SEARCH_REQUEST_ID || null,
            owner_user_id: ownerUserId,
            status: response.status,
            elapsed_ms: Date.now() - startedAt
        });

        if (!response.ok) {
            const message = typeof body === "string"
                ? body
                : body.message || body.error || "";

            throw new Error(
                message ||
                "n8n webhook returned HTTP " +
                    response.status +
                    ": " +
                    text.slice(0, 500)
            );
        }

        return {
            status: response.status,
            body
        };
    } finally {
        clearTimeout(timeout);
    }
}

if (require.main === module) {
    sendToN8N().catch(error => {
        console.error("Failed to send data to n8n");
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = {
    sendToN8N
};
