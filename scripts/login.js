const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { LINKEDIN_SESSION_PATH } = require("../config/linkedin-session");
const startBrowser = require("../services/browser");
const {
  validateStorageState,
  writeStorageStateAtomic
} = require("../services/linkedin-session-state");

delete process.env.PWDEBUG;
delete process.env.PWDEBUGIMPL;

(async () => {
  let browser;

  try {
    fs.mkdirSync(path.dirname(LINKEDIN_SESSION_PATH), {
      recursive: true
    });

    browser = await chromium.launch({
      headless: false,
      devtools: false
    });

    const context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 900
      }
    });

    const page = await context.newPage();

    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded"
    });

    console.log("");
    console.log("Log into LinkedIn in the opened browser.");
    console.log("Complete any verification or security challenge.");
    console.log("After LinkedIn opens your authenticated home page, return here and press ENTER.");
    console.log("");

    process.stdin.resume();

    await new Promise(resolve => {
      process.stdin.once("data", resolve);
    });

    await startBrowser.assertLinkedInAuthenticated(
      page,
      45000,
      { browser, context }
    );

    const savedState = await context.storageState();
    validateStorageState(savedState);
    writeStorageStateAtomic(LINKEDIN_SESSION_PATH, savedState);

    console.log("");
    console.log("LinkedIn session saved successfully.");
    console.log("Session path:", LINKEDIN_SESSION_PATH);
  } catch (error) {
    console.error("");
    console.error("Failed to save LinkedIn session:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
