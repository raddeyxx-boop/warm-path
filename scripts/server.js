const express = require("express");
const { exec } = require("child_process");
const path = require("path");

const app = express();

app.use(express.json());

const PROJECT_DIR = __dirname;

// Health check
app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "LinkedIn Warm Path Finder",
        status: "Running"
    });
});

// Run pipeline
app.post("/run", (req, res) => {

    const {
        target,
        url = "",
        company = ""
    } = req.body;

    if (!target) {
        return res.status(400).json({
            success: false,
            message: "Target is required."
        });
    }

    const command =
        `node index.js "${target}" "${url}" "${company}"`;

    exec(
        command,
        {
            cwd: PROJECT_DIR
        },
        (error, stdout, stderr) => {

            if (error) {
                return res.status(500).json({
                    success: false,
                    error: error.message,
                    stderr
                });
            }

            return res.json({
                success: true,
                target,
                output: stdout
            });

        }
    );

});

const PORT = 3000;

app.listen(PORT, () => {

    console.log("=================================");
    console.log("Warm Path API Running");
    console.log("=================================");
    console.log(`http://localhost:${PORT}`);
    console.log("=================================");

});