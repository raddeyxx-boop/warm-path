const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { createStartSearchHandler } = require("./services/search-api");

const app = express();

const ROOT = __dirname;

const INDEX = path.join(ROOT, "index.js");

const MUTUAL_DETAILS = path.join(
    ROOT,
    "data",
    "mutual-details.json"
);
app.use(express.json());

const PORT = process.env.PORT || 3000;
let activeRun = null;

const DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173"
];
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
const browserAllowedOrigins = allowedOrigins.length
    ? allowedOrigins
    : DEFAULT_ALLOWED_ORIGINS;

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && browserAllowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    return next();
});

function readBearerToken(req) {
    const authorization = req.headers.authorization || "";
    const [scheme, token] = authorization.split(/\s+/);

    if (scheme?.toLowerCase() !== "bearer" || !token) {
        return "";
    }

    return token;
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "LinkedIn Warm Path Finder API",
        version: "1.0.0",
        status: "Running",
        timestamp: new Date().toISOString()
    });
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "Healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.post("/api/searches/start", createStartSearchHandler());

app.post("/run", async (req, res) => {
    try {
        const {
            target,
            company = "",
            url = "",
            owner_user_id: ownerUserId = ""
        } = req.body;
        const accessToken = readBearerToken(req);

        if (!target || target.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Target name is required."
            });
        }

        if (!ownerUserId) {
            return res.status(401).json({
                success: false,
                message: "You must be signed in before starting a workflow."
            });
        }

        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: "Your session is missing an access token. Please sign in again."
            });
        }

        if (activeRun) {
            return res.status(409).json({
                success: false,
                message: "A scraper run is already active.",
                started_at: activeRun.startedAt
            });
        }

        console.log("");
        console.log("========================================");
        console.log("NEW PIPELINE REQUEST");
        console.log("========================================");
        console.log("Time    :", new Date().toLocaleString());
        console.log("Target  :", target);
        console.log("Company :", company || "Not provided");
        console.log("URL     :", url || "Not provided");
        console.log("Owner   :", ownerUserId);
        console.log("========================================");

        /// ----------------------------
// Execute Playwright Pipeline
// ----------------------------

console.log("========== STEP 1 ==========");
console.log("Starting index.js...");

const args = [INDEX, target];

if (url) {
    args.push(url);

    if (company) {
        args.push(company);
    }
} else if (company) {
    args.push(company);
}

activeRun = {
    startedAt: new Date().toISOString(),
    target
};

try {
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: ROOT,
            env: {
                ...process.env,
                OWNER_USER_ID: ownerUserId,
                SUPABASE_ACCESS_TOKEN: accessToken
            },
            stdio: ["ignore", "inherit", "inherit"]
        });

        child.on("error", reject);
        child.on("close", code => {
            console.log("========== STEP 2 ==========");
            console.log("index.js finished.");

            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error("index.js exited with code " + code));
        });
    });
} finally {
    activeRun = null;
}

console.log("========== STEP 3 ==========");
console.log("Reading mutual-details.json...");  

if (!fs.existsSync(MUTUAL_DETAILS)) {
    throw new Error("mutual-details.json was not generated.");
}

const mutualConnections = JSON.parse(
    fs.readFileSync(MUTUAL_DETAILS, "utf8")
);

return res.json({
    success: true,
    target,
    company,
    url,
    total_connections: mutualConnections.length,
    mutual_connections: mutualConnections
});
    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: err.message
        });

    }
});   // <-- closes app.post("/run")

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint not found."
    });
});

function startServer() {
return app.listen(PORT, () => {
    console.log("");
    console.log("========================================");
    console.log(" LinkedIn Warm Path Finder API");
    console.log("========================================");
    console.log(` Server : http://localhost:${PORT}`);
    console.log(` Health : http://localhost:${PORT}/health`);
    console.log(` Run API: POST http://localhost:${PORT}/run`);
    console.log(` Search API: POST http://localhost:${PORT}/api/searches/start`);
    console.log("========================================");
});
}

module.exports = { app, startServer };

if (require.main === module) {
    startServer();
}
