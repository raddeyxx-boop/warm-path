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
const { emitProgress } = require("./utils/ProgressEvents");
const { buildFinalExtractionResult, writeFinalExtractionResult } = require("./services/final-extraction-result");
const CHILD_ERROR_PREFIX = "__WARM_PATH_ERROR__=";

let cancellationRequested = false;
let cancellationReason = "";
let activePipelineBrowser = null;
let activePipelineCleanup = null;
let activeStageChild = null;

class WorkflowStoppedError extends Error {
  constructor(stage) {
    super(`${cancellationReason || "Workflow stopped by user."} Stage: ${stage}.`);
    this.name = "WorkflowStoppedError";
  }
}

function throwIfCancellationRequested(stage) {
  if (cancellationRequested) throw new WorkflowStoppedError(stage);
}

function requestCancellation(reason) {
  if (cancellationRequested) return;
  cancellationRequested = true;
  cancellationReason = reason || "Workflow stopped by user.";
  console.log("[Cancellation] Stop requested.", {
    workflow_run_id: process.env.WORKFLOW_RUN_ID || null,
    reason: cancellationReason
  });
  if (activeStageChild && !activeStageChild.killed) activeStageChild.kill("SIGTERM");
  if (activePipelineCleanup) {
    void activePipelineCleanup(cancellationReason).catch(error => {
      console.error("[Cancellation] Browser close failed:", error.message);
    });
  } else if (activePipelineBrowser) {
    void activePipelineBrowser.close().catch(error => {
      console.error("[Cancellation] Browser close failed:", error.message);
    });
  }
}

const ROOT_DIR = __dirname;
if ((process.env.WORKFLOW_RUN_ID || process.env.SEARCH_REQUEST_ID) && !process.env.WARM_PATH_RUN_DIR) {
  throw new Error("Managed target search requires a run-specific WARM_PATH_RUN_DIR.");
}
const DATA_DIR = path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(ROOT_DIR, "data"));

const FILES = {
  target: path.join(DATA_DIR, "target.json"),
  mutuals: path.join(DATA_DIR, "mutuals.json"),
  mutualDetails: path.join(DATA_DIR, "mutual-details.json"),
  mutualDetailsClassified: path.join(
    DATA_DIR,
    "mutual-details-classified.json"
  ),
  checkpoint: path.join(DATA_DIR, "workflow-checkpoint.json")
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
    const legacyLinkedInValue = (supplied.linkedin_name || "").trim();
    const linkedinUrl = (supplied.linkedin_url || supplied.url ||
      (/^https?:\/\/(?:www\.)?linkedin\.com\/in\//i.test(legacyLinkedInValue)
        ? legacyLinkedInValue
        : "")).trim();
    return {
      ...supplied,
      name: supplied.name.trim(),
      linkedin_name: /^https?:\/\//i.test(legacyLinkedInValue)
        ? supplied.name.trim()
        : (legacyLinkedInValue || supplied.name.trim()),
      linkedin_url: linkedinUrl,
      url: linkedinUrl,
      company: (supplied.company || supplied.current_company || supplied.company_filter || "").trim(),
      createdAt: new Date().toISOString()
    };
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
    linkedin_name: targetName,
    linkedin_url: url,
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
    keywords: targetConfig.keywords || "",
    company_filter: targetConfig.company_filter || "",
    school_filter: targetConfig.school_filter || "",
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
    const configuredTimeout = Number(process.env.WARM_PATH_CHILD_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 4 * 60 * 60 * 1000;
    let settled = false;
    const child = spawn(process.execPath, [scriptPath], {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderrTail = "";
    const retain = chunk => {
      stderrTail = (stderrTail + chunk.toString()).slice(-12000);
    };
    child.stdout.on("data", chunk => process.stdout.write(chunk));
    child.stderr.on("data", chunk => { process.stderr.write(chunk); retain(chunk); });
    activeStageChild = child;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (activeStageChild === child) activeStageChild = null;
      if (error) reject(error); else resolve();
    };
    const timeout = setTimeout(() => {
      console.error("[index.js:runNodeScript] Child process exceeded its bounded runtime.", {
        script: scriptPath,
        timeout_ms: timeoutMs,
        recovery: "terminate child and fail the workflow"
      });
      child.kill("SIGTERM");
      finish(new Error(`${scriptPath} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", error => finish(new Error(`${scriptPath} failed to start: ${error.message}`, { cause: error })));
    child.on("close", code => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderrTail.trim();
      finish(new Error(scriptPath + " exited with code " + code + (detail ? `:\n${detail}` : "")));
    });
  });
}

async function main() {
  const startedAt = Date.now();
  let browser;
  let browserSession;

  try {
    const managedContext = {
      owner_user_id: process.env.OWNER_USER_ID || "",
      workflow_run_id: process.env.WORKFLOW_RUN_ID || "",
      search_request_id: process.env.SEARCH_REQUEST_ID || ""
    };
    if (process.env.WARM_PATH_RUN_DIR && Object.values(managedContext).some(value => !value)) {
      throw new Error("Managed Playwright execution is missing authenticated workflow ownership context.");
    }
    if (process.env.WARM_PATH_RUN_DIR) console.log("[PLAYWRIGHT_CONTEXT]", managedContext);
    const targetConfig = parseArgs(process.argv);
    emitProgress("starting_search");
    console.log("Parsed targetConfig:");
console.log(targetConfig);

    logHeader(targetConfig);

    const effectiveTargetConfig = prepareRunState(targetConfig);
    console.log("");
    console.log("Target configuration saved");

console.log("");
console.log("Checking LinkedIn session...");
console.log("Launching LinkedIn...");
const session = await startBrowser();
browserSession = session;
console.log("Session verified");
emitProgress("linkedin_session_verified");

browser = session.browser;
activePipelineBrowser = browser;
activePipelineCleanup = session.cleanup;
const { page } = session;
session.lifecycle.assertLive("before_target_search", "startup helper returned a verified live page");

console.log("");
console.log("STEP 1");
console.log("Open Target & Connections");
throwIfCancellationRequested("before target search");
await searchTarget(page);
throwIfCancellationRequested("after target search");

console.log("");
console.log("STEP 2");
emitProgress("collecting_connections");
console.log("Collect Mutuals");
console.log("Entering mutual collection...");
await collectMutuals(page);
throwIfCancellationRequested("after mutual collection");
const mutualCount = JSON.parse(fs.readFileSync(FILES.mutuals, "utf8")).length;
const mutualsParentState = {
  url: page.url(),
  scrollY: await page.evaluate(() => window.scrollY).catch(() => 0)
};
writeJsonAtomicSync(FILES.checkpoint, {
  stage: "STAGE_1_COMPLETED",
  mutual_count: mutualCount,
  mutuals_parent_page: mutualsParentState,
  completed_at: new Date().toISOString(),
  resume_after: new Date(Date.now() + 30_000).toISOString()
});

await browserSession.cleanup("mutual_collection_completed");
browser = null;
browserSession = null;
activePipelineBrowser = null;
activePipelineCleanup = null;

console.log("");
console.log("STEP 2 Completed");
console.log("Browser closed.");

console.log("");
console.log("Cooling down before starting a new browser session...");
console.log("Waiting 30 seconds...");

await new Promise(resolve => setTimeout(resolve, 30_000));
writeJsonAtomicSync(FILES.checkpoint, {
  ...JSON.parse(fs.readFileSync(FILES.checkpoint, "utf8")),
  stage: "STAGE_2_READY",
  resumed_at: new Date().toISOString()
});

console.log("Cooldown complete.");

console.log("");
console.log("STEP 3");
console.log("Scrape Profile Details");
console.log("Beginning mutual scraping...");

throwIfCancellationRequested("before profile processing");
await runNodeScript("scripts/scrape-profile-details.js");
throwIfCancellationRequested("after profile processing");
const processedCount = JSON.parse(fs.readFileSync(FILES.mutualDetails, "utf8")).length;
emitProgress("building_candidates", undefined, { profiles_processed: processedCount });

console.log("Profile details completed.");

console.log("");
console.log("STEP 4");
console.log("Classification");

throwIfCancellationRequested("before classification");
await runNodeScript("scripts/classify-all.js");
throwIfCancellationRequested("after classification");
const rankedCount = JSON.parse(fs.readFileSync(FILES.mutualDetailsClassified, "utf8")).length;

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
console.log("Finalize extraction result");

throwIfCancellationRequested("before final result handoff");
const connections = JSON.parse(fs.readFileSync(FILES.mutuals, "utf8"));
const result = buildFinalExtractionResult({
  ownerUserId: process.env.OWNER_USER_ID,
  workflowRunId: process.env.WORKFLOW_RUN_ID,
  searchRequestId: process.env.SEARCH_REQUEST_ID,
  target,
  connections,
  candidates: classifiedMutualConnections
});
const resultFile = writeFinalExtractionResult(
  process.env.WARM_PATH_RESULT_FILE || path.join(DATA_DIR, "final-extraction.json"),
  result
);
console.log("[PLAYWRIGHT_RESULT_READY]", {
  owner_user_id: result.owner_user_id,
  workflow_run_id: result.workflow_run_id,
  search_request_id: result.search_request_id,
  result_file: resultFile
});
console.log(`__WARM_PATH_RESULT_FILE__=${resultFile}`);
emitProgress("extraction_completed", undefined, { candidate_count: rankedCount, connection_count: connections.length });
console.log("[PLAYWRIGHT_EXTRACTION_COMPLETED]", {
  owner_user_id: result.owner_user_id,
  workflow_run_id: result.workflow_run_id,
  search_request_id: result.search_request_id,
  target_name: result.target?.name || null,
  connection_count: connections.length,
  mutual_connection_count: connections.length,
  candidate_count: rankedCount,
  completed_at: result.completed_at
});
    console.log("");
    console.log("Pipeline Complete");
    console.log("Execution time:", formatDuration(startedAt));
    logOutputs();
    console.log("");

  } catch (err) {
    if (cancellationRequested || err instanceof WorkflowStoppedError) {
      console.log("[Cancellation] Workflow stopped safely. Partial output files were preserved.", {
        workflow_run_id: process.env.WORKFLOW_RUN_ID || null,
        reason: cancellationReason || err.message
      });
      return;
    }
    console.error("");
    console.error("Pipeline Failed");
    console.error("===============");
    console.error("File: index.js");
    console.error("Function: main");
    console.error("Reason:", err.message);
    console.error("Recovery: saving already-written data files and closing the browser session.");
    console.error("Execution time:", formatDuration(startedAt));
    console.log(CHILD_ERROR_PREFIX + JSON.stringify({
      code: String(err.code || "PLAYWRIGHT_PIPELINE_FAILED").slice(0, 80),
      message: String(err.message || "Playwright workflow failed.").slice(0, 500)
    }));

    if (err.message === "Target name is required.") {
      printUsage();
    }

    process.exitCode = 1;
  } finally {
    if (browserSession) {
      await browserSession.cleanup(process.exitCode ? "workflow_failed" : "workflow_completed").catch(err => {
        console.error("Browser cleanup failed:", err.message);
      });
    } else if (browser) {
      await browser.close().catch(err => {
        console.error("Browser cleanup failed:", err.message);
      });
    }
    activePipelineBrowser = null;
    activePipelineCleanup = null;
    activeStageChild = null;
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
  process.once("SIGINT", () => requestCancellation("Workflow stopped by SIGINT."));
  process.once("SIGTERM", () => requestCancellation("Workflow stopped by user."));
  main();
}
