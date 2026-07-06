const fs = require("fs");
const path = require("path");
const startBrowser = require("./services/browser");
const searchTarget = require("./scripts/search-pavel");
const collectMutuals = require("./scripts/collect-mutuals");

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");

const FILES = {
  target: path.join(DATA_DIR, "target.json"),
  mutuals: path.join(DATA_DIR, "mutuals.json"),
  mutualDetails: path.join(DATA_DIR, "mutual-details.json")
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

  fs.writeFileSync(
    FILES.target,
    JSON.stringify(targetConfig, null, 2) + "\n",
    "utf8"
  );
}

function clearPreviousOutputs() {
  for (const filePath of [
    FILES.mutuals,
    FILES.mutualDetails
  ]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
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

async function main() {
  const startedAt = Date.now();

  try {
    const targetConfig = parseArgs(process.argv);
    console.log("Parsed targetConfig:");
console.log(targetConfig);

    logHeader(targetConfig);

    saveTargetConfig(targetConfig);
    clearPreviousOutputs();
    console.log("");
    console.log("Target configuration saved");

 console.log("");
console.log("Checking LinkedIn session...");
const session = await startBrowser();
console.log("Session verified");

const { browser, page } = session;

console.log("");
console.log("STEP 1");
console.log("Open Target & Connections");
await searchTarget(page);

console.log("");
console.log("STEP 2");
console.log("Collect Mutuals");
await collectMutuals(page);

const target = JSON.parse(
  fs.readFileSync(FILES.target, "utf8")
);

const mutualConnections = JSON.parse(
  fs.readFileSync(FILES.mutuals, "utf8")
);

console.log("");
console.log("Sending data to n8n...");
console.log("========== SENDING TO N8N ==========");
console.log(JSON.stringify({
    target,
    mutual_connections: mutualConnections
}, null, 2));
console.log("====================================");


console.log("Data sent to n8n successfully.");
    console.log("");
    console.log("Pipeline Complete");
    console.log("Execution time:", formatDuration(startedAt));
    logOutputs();
    console.log("");
    await browser.close();

  } catch (err) {
    console.error("");
    console.error("Pipeline Failed");
    console.error("===============");
    console.error(err.message);
    console.error("Execution time:", formatDuration(startedAt));

    if (err.message === "Target name is required.") {
      printUsage();
    }

    process.exitCode = 1;
  }
}

main();
