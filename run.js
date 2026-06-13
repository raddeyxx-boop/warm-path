const { execSync } = require("child_process");

const targetName = process.argv[2];
const targetUrl = process.argv[3];
const company = process.argv[4];

console.log("================================");
console.log("TARGET:", targetName);
console.log("URL:", targetUrl);
console.log("COMPANY:", company);
console.log("================================");

execSync("node scripts/collect-mutuals.js", {
  stdio: "inherit",
});

execSync("node scripts/scrape-profile-details.js", {
  stdio: "inherit",
});

execSync("node scripts/rank-mutuals.js", {
  stdio: "inherit",
});

console.log("Finished");