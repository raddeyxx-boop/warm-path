const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { LINKEDIN_SESSION_PATH } = require("../config/linkedin-session");
const startBrowser = require("../services/browser");
const {
  cookieExpired,
  cookieValueHash,
  sessionFileDiagnostic,
  sessionStateDiagnostic,
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

    console.log("[CONTEXT_CONFIGURATION_DIAGNOSTIC]", {
      source: "login",
      browser_type: "chromium",
      channel: null,
      headless: false,
      executable_path: null,
      user_agent: null,
      viewport: { width: 1440, height: 900 },
      locale: null,
      timezone_id: null,
      proxy_configured: false,
      storage_state_path: null,
      persistent_context: false,
      launch_args: []
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
    const cookiesBeforeNavigation = await context.cookies("https://www.linkedin.com");
    const liAtBeforeNavigation = cookiesBeforeNavigation.find(cookie => cookie.name === "li_at");
    console.log("[SESSION_BEFORE_NAVIGATION]", {
      context_cookie_count: cookiesBeforeNavigation.length,
      linkedin_cookie_count: cookiesBeforeNavigation.length,
      li_at_present: Boolean(liAtBeforeNavigation),
      li_at_expired: Boolean(liAtBeforeNavigation && cookieExpired(liAtBeforeNavigation)),
      li_at_hash: cookieValueHash(liAtBeforeNavigation),
      current_url: page.url()
    });

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

    const candidateState = await context.storageState();
    validateStorageState(candidateState);

    const validationContext = await browser.newContext({
      storageState: candidateState,
      viewport: {
        width: 1440,
        height: 900
      }
    });
    let savedState;
    try {
      const validationPage = await validationContext.newPage();
      await startBrowser.assertLinkedInAuthenticated(
        validationPage,
        45000,
        { browser, context: validationContext }
      );
      savedState = await validationContext.storageState();
      validateStorageState(savedState);
    } finally {
      await validationContext.close();
    }

    writeStorageStateAtomic(LINKEDIN_SESSION_PATH, savedState);
    const savedFile = sessionFileDiagnostic(LINKEDIN_SESSION_PATH);
    console.log("[SESSION_PATH_DIAGNOSTIC]", {
      save_path: LINKEDIN_SESSION_PATH,
      load_path: LINKEDIN_SESSION_PATH,
      save_path_absolute: savedFile.path_absolute,
      load_path_absolute: savedFile.path_absolute,
      paths_match: true,
      file_exists: savedFile.file_exists,
      file_size: savedFile.file_size,
      file_modified_at: savedFile.file_modified_at
    });
    console.log("[SESSION_STATE_DIAGNOSTIC]", sessionStateDiagnostic(savedState));

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
