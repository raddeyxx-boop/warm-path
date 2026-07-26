const { chromium } = require("playwright");
const { LINKEDIN_SESSION_PATH } = require("../config/linkedin-session");

delete process.env.PWDEBUG;
delete process.env.PWDEBUGIMPL;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: false
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  await page.goto("https://www.linkedin.com/login");

  console.log("LOGIN MANUALLY");
  console.log("After login press ENTER here");

  process.stdin.once("data", async () => {
    await context.storageState({
      path: LINKEDIN_SESSION_PATH
    });

    console.log("Session Saved", { session_path: LINKEDIN_SESSION_PATH });
    await browser.close();
  });
})();
