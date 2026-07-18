const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const startBrowser = require("./services/browser");
const searchTarget = require("./scripts/search-pavel");
const collectMutuals = require("./scripts/collect-mutuals");
const {
  writeJsonAtomicSync
} = require("./utils/JsonFileStore");
const {
  normalizeCompany
} = require("./utils/CompanyNormalizer");
const { updateWorkflowProgress } = require("./utils/WorkflowProgress");


const ROOT_DIR = __dirname;
const DATA_DIR = path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(ROOT_DIR, "data"));

const FILES = {
  target: path.join(DATA_DIR, "target.json"),
  mutuals: path.join(DATA_DIR, "mutuals.json"),
  mutualDetails: path.join(DATA_DIR, "mutual-details.json"),
  mutualDetailsClassified: path.join(
    DATA_DIR,
    "mutual-details-classified.json"
  )
};



function printUsage() {
  console.log(`
Usage:

node index.js "Target Name"

Optional:

node index.js "Target Name" "LinkedIn URL"
node index.js "Target Name" "LinkedIn URL" "Company"
`);
}

function formatDuration(startTime) {
  const elapsedMs = Date.now() - startTime;
  return (elapsedMs / 1000).toFixed(1) + "s";
}

function parseArgs(argv) {

  if (process.env.WARM_PATH_TARGET_JSON) {
    const supplied = JSON.parse(process.env.WARM_PATH_TARGET_JSON);
    if (!supplied.name?.trim()) throw new Error("Target name is required.");
    return { ...supplied, name: supplied.name.trim(), createdAt: new Date().toISOString() };
  }

  const targetName = (argv[2] || "").trim();
  const secondArg = (argv[3] || "").trim();
  const thirdArg = (argv[4] || "").trim();

  if (!targetName) {
    throw new Error("Target name is required.");
  }

  let url = "";
  let company = "";

  if (
    secondArg.startsWith("http://") ||
    secondArg.startsWith("https://")
  ) {
    url = secondArg;
    company = thirdArg;
  } else {
    company = secondArg;
  }

  return {
    name: targetName,
    company,
    url,
    createdAt: new Date().toISOString()
  };
}

function ensureDataDirectory() {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

function saveTargetConfig(targetConfig) {
  ensureDataDirectory();

  writeJsonAtomicSync(FILES.target, targetConfig);
}

function createEmptyCheckpointFiles() {
  writeJsonAtomicSync(FILES.mutuals, []);
  writeJsonAtomicSync(FILES.mutualDetails, []);
}

function loadExistingTargetConfig() {
  try {
    if (!fs.existsSync(FILES.target)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(FILES.target, "utf8"));
  } catch (err) {
    console.log("Warning: ignoring existing target.json:", err.message);
    return null;
  }
}

function normalizeTargetValue(value) {
  return (value || "")
    .toString()
    .replace(/&/g, " and ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeTargetCompany(value) {
  return normalizeCompany(normalizeTargetValue(value));
}

function sameTarget(left = {}, right = {}) {
  const previousTarget = left || {};
  const currentTarget = right || {};
  const leftName = normalizeTargetValue(previousTarget.name);
  const rightName = normalizeTargetValue(currentTarget.name);
  const leftCompany = normalizeTargetCompany(previousTarget.company || previousTarget.current_company);
  const rightCompany = normalizeTargetCompany(currentTarget.company || currentTarget.current_company);

  return Boolean(leftName && rightName && leftName === rightName && leftCompany === rightCompany);
}

function deleteCheckpointFiles(filesToClear) {
  for (const filePath of filesToClear) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function targetWithLatestInput(existingTarget, targetConfig, isSameTarget) {
  if (!isSameTarget) {
    return targetConfig;
  }

  return {
    ...existingTarget,
    ...targetConfig,
    url: targetConfig.url || existingTarget.url || existingTarget.linkedin_url || "",
    linkedin_url: targetConfig.url || existingTarget.linkedin_url || existingTarget.url || ""
  };
}

function prepareRunState(targetConfig) {
  console.log("--------------------------------");
  console.log("Checking previous target...");

  const existingTarget = loadExistingTargetConfig();
  const isSameTarget = sameTarget(existingTarget, targetConfig);
  const effectiveTarget = targetWithLatestInput(
    existingTarget || {},
    targetConfig,
    isSameTarget
  );

  if (!existingTarget) {
    console.log("No previous target found.");
    console.log("Creating fresh workspace...");
    deleteCheckpointFiles([
      FILES.mutuals,
      FILES.mutualDetails
    ]);
    createEmptyCheckpointFiles();
    saveTargetConfig(effectiveTarget);
    console.log("Workspace ready.");
    console.log("Starting new scraping session...");
    return effectiveTarget;
  }

  if (!isSameTarget) {
    console.log("New target detected.");
    console.log("Deleting previous checkpoints...");
    deleteCheckpointFiles([
      FILES.mutuals,
      FILES.mutualDetails
    ]);
    console.log("Deleted:");
    console.log("mutuals.json");
    console.log("Deleted:");
    console.log("mutual-details.json");
    console.log("Creating fresh data files...");
    createEmptyCheckpointFiles();
    saveTargetConfig(effectiveTarget);
    console.log("Workspace ready.");
    console.log("Starting new scraping session...");
    return effectiveTarget;
  }

  console.log("Same target detected.");
  console.log("Preserving:");
  console.log("mutuals.json");
  console.log("Preserving:");
  console.log("mutual-details.json");
  console.log("Updating target.json");
  saveTargetConfig(effectiveTarget);
  console.log("Resuming previous scraping session...");

  return effectiveTarget;
}




function logHeader(targetConfig) {
  console.log("");
  console.log("=====================================");
  console.log("LinkedIn Warm Path Finder");
  console.log("=====================================");
  console.log("");
  console.log("Target :", targetConfig.name);
  console.log("Company:", targetConfig.company || "Not provided");
  console.log("URL    :", targetConfig.url || "Not provided");
}

function logOutputs() {
  console.log("");
  console.log("Output Files:");
  console.log(path.relative(ROOT_DIR, FILES.target));
  console.log(path.relative(ROOT_DIR, FILES.mutuals));
  console.log(path.relative(ROOT_DIR, FILES.mutualDetails));
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: ROOT_DIR,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(scriptPath + " exited with code " + code));
    });
  });
}

async function main() {
  const startedAt = Date.now();
  let browser;

  try {
    const targetConfig = parseArgs(process.argv);
    await updateWorkflowProgress("starting");
    console.log("Parsed targetConfig:");
console.log(targetConfig);

    logHeader(targetConfig);

    const effectiveTargetConfig = prepareRunState(targetConfig);
    console.log("");
    console.log("Target configuration saved");

console.log("");
console.log("Checking LinkedIn session...");
console.log("Launching LinkedIn...");
await updateWorkflowProgress("starting", { current_message: "Opening LinkedIn...", progress_percent: 15 });
const session = await startBrowser();
console.log("Session verified");

browser = session.browser;
const { page } = session;

console.log("");
console.log("STEP 1");
await updateWorkflowProgress("searching_linkedin");
console.log("Open Target & Connections");
await searchTarget(page);

console.log("");
console.log("STEP 2");
await updateWorkflowProgress("finding_mutual_connections");
console.log("Collect Mutuals");
await collectMutuals(page);
const mutualCount = JSON.parse(fs.readFileSync(FILES.mutuals, "utf8")).length;
await updateWorkflowProgress("processing_profiles", { profiles_found: mutualCount, mutual_connections: mutualCount });

await browser.close();
browser = null;

console.log("");
console.log("STEP 2 Completed");
console.log("Browser closed.");

console.log("");
console.log("Cooling down before starting a new browser session...");
console.log("Waiting 30 seconds...");

await new Promise(resolve =>
    setTimeout(resolve, 30000)
);

console.log("Cooldown complete.");

console.log("");
console.log("STEP 3");
console.log("Scrape Profile Details");
console.log("Beginning mutual scraping...");

await runNodeScript("scripts/scrape-profile-details.js");
const processedCount = JSON.parse(fs.readFileSync(FILES.mutualDetails, "utf8")).length;
await updateWorkflowProgress("ranking_candidates", { profiles_processed: processedCount });

console.log("Profile details completed.");

console.log("");
console.log("STEP 4");
console.log("Classification");

await runNodeScript("scripts/classify-all.js");
const rankedCount = JSON.parse(fs.readFileSync(FILES.mutualDetailsClassified, "utf8")).length;
await updateWorkflowProgress("ai_analysis", { candidates_ranked: rankedCount });

console.log("Classification completed.");
const target = JSON.parse(
    fs.readFileSync(FILES.target, "utf8")
);

const classifiedMutualConnections = JSON.parse(
    fs.readFileSync(FILES.mutualDetailsClassified, "utf8")
);

if (!target || !Array.isArray(classifiedMutualConnections)) {
    throw new Error("Final pipeline outputs failed JSON structure validation.");
}
console.log("");
console.log("STEP 5");
console.log("Send to n8n");
await updateWorkflowProgress("saving_results");

await runNodeScript("scripts/send-to-n8n.js");

console.log("Data sent to n8n successfully.");
    console.log("");
    console.log("Pipeline Complete");
    console.log("Execution time:", formatDuration(startedAt));
    logOutputs();
    console.log("");

  } catch (err) {
    await updateWorkflowProgress("failed", { current_message: String(err.message).slice(0, 500) }).catch(() => {});
    console.error("");
    console.error("Pipeline Failed");
    console.error("===============");
    console.error("File: index.js");
    console.error("Function: main");
    console.error("Reason:", err.message);
    console.error("Recovery: saving already-written data files and closing the browser session.");
    console.error("Execution time:", formatDuration(startedAt));

    if (err.message === "Target name is required.") {
      printUsage();
    }

    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(err => {
        console.error("Browser cleanup failed:", err.message);
      });
    }
  }
}

module.exports = {
  FILES,
  normalizeTargetValue,
  normalizeTargetCompany,
  parseArgs,
  prepareRunState,
  sameTarget
};

if (require.main === module) {
  main();
}
