const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("playwright");

(async () => {
  const targetName = process.argv[2];
  const targetUrl = process.argv[3];
  const company = process.argv[4];

  if (!targetName || !targetUrl || !company) {
    console.log(`
Usage:

node index.js "Name" "LinkedIn URL" "Company"

Example:

node index.js "Gurupreet Singh" "https://www.linkedin.com/in/gurupreet-singh-2344aa2bb/" "Indpro"
`);
    process.exit(1);
  }

  console.log("\n=================================");
  console.log("LINKEDIN WARM PATH FINDER");
  console.log("=================================");
  console.log("Target :", targetName);
  console.log("Company:", company);
  console.log("URL    :", targetUrl);
  console.log("=================================\n");

  // Save target configuration
  const targetConfig = {
    name: targetName,
    company,
    url: targetUrl,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(__dirname, "data", "target.json"),
    JSON.stringify(targetConfig, null, 2)
  );

  console.log("OK Target saved");

  // Verify LinkedIn session
  console.log("\nChecking LinkedIn session...");

  const context = await chromium.launchPersistentContext(
    "C:\\Users\\3iwa\\AppData\\Local\\Google\\Chrome\\User Data",
    {
      channel: "chrome",
      headless: false,
      args: ["--profile-directory=Profile 1"]
    }
  );

  const page = context.pages()[0] || await context.newPage();

  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "networkidle"
  });

  if (!page.url().includes("linkedin.com")) {
    throw new Error("LinkedIn session invalid.");
  }

  console.log("OK LinkedIn session verified");

  await context.close();

  try {

    console.log("\nSTEP 1 - Collect Mutuals");
    execSync("node scripts/collect-mutuals.js", {
      stdio: "inherit"
    });

    console.log("\nSTEP 2 - Scrape Profile Details");
    execSync("node scripts/scrape-profile-details.js", {
      stdio: "inherit"
    });

    console.log("\nSTEP 3 - Rank Mutuals");
    execSync("node scripts/rank-mutuals.js", {
      stdio: "inherit"
    });

    console.log("\n=================================");
    console.log("PIPELINE COMPLETE");
    console.log("=================================");
    console.log("Output Files:");
    console.log("data/target.json");
    console.log("data/mutuals.json");
    console.log("data/ranked-mutuals.csv");
    console.log("=================================\n");

  } catch (err) {
    console.error("\nPIPELINE FAILED");
    console.error(err.message);
    process.exit(1);
  }

})();