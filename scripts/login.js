const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext();

  const page = await context.newPage();

  await page.goto("https://www.linkedin.com/login");

  console.log("LOGIN MANUALLY");
  console.log("After login press ENTER here");

  process.stdin.once("data", async () => {
    await context.storageState({
      path: "./sessions/linkedin.json"
    });

    console.log("Session Saved");
    await browser.close();
  });
})();