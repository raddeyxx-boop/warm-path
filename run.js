const path = require("path");
const { execFileSync } = require("child_process");

const indexPath = path.join(__dirname, "index.js");
const args = process.argv.slice(2);

execFileSync(process.execPath, [indexPath, ...args], {
  cwd: __dirname,
  stdio: "inherit"
});
