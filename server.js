const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");

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

app.post("/run", async (req, res) => {
    try {
        const {
            target,
            company = "",
            url = ""
        } = req.body;

        if (!target || target.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Target name is required."
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
        console.log("========================================");

        /// ----------------------------
// Execute Playwright Pipeline
// ----------------------------

console.log("========== STEP 1 ==========");
console.log("Starting index.js...");

await new Promise((resolve, reject) => {

    execFile(
        process.execPath,
        [
            INDEX,
            target,
            url,
            company
        ],
        {
            cwd: ROOT
        },
        (error, stdout, stderr) => {

            console.log("========== STEP 2 ==========");
            console.log("index.js finished.");

            if (stdout) {
                console.log(stdout);
            }

            if (stderr) {
                console.error(stderr);
            }

            if (error) {
                console.error(error);
                return reject(error);
            }

            resolve();

        }
    );

});

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

app.listen(PORT, () => {
    console.log("");
    console.log("========================================");
    console.log(" LinkedIn Warm Path Finder API");
    console.log("========================================");
    console.log(` Server : http://localhost:${PORT}`);
    console.log(` Health : http://localhost:${PORT}/health`);
    console.log(` Run API: POST http://localhost:${PORT}/run`);
    console.log("========================================");
});
