const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const SESSION_PATH = path.resolve(__dirname, "..", "sessions", "linkedin.json");
const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";

const DEFAULT_OPTIONS = {
    channel: "chrome",
    headless: false,
    slowMo: 150,
    viewport: {
        width: 1366,
        height: 900
    },
    authCheck: true,
    navigationTimeout: 45000
};

function assertSessionExists(sessionPath) {
    if (!fs.existsSync(sessionPath)) {
        throw new Error(
            "LinkedIn session file not found at " +
            sessionPath +
            ". Run `node scripts/login.js` to create a fresh session."
        );
    }
}

function isLinkedInLoginUrl(url) {
    return (
        url.includes("/login") ||
        url.includes("/checkpoint") ||
        url.includes("/uas/login")
    );
}

async function assertLinkedInAuthenticated(page, navigationTimeout) {
    page.setDefaultNavigationTimeout(navigationTimeout);

    await page.goto(LINKEDIN_FEED_URL, {
        waitUntil: "domcontentloaded"
    });

    await page.waitForLoadState("networkidle", {
        timeout: 1000
    }).catch(() => {});

    const currentUrl = page.url();

    if (
        !currentUrl.includes("linkedin.com") ||
        isLinkedInLoginUrl(currentUrl)
    ) {
        throw new Error(
            "LinkedIn session is not authenticated. " +
            "Refresh it by running `node scripts/login.js`."
        );
    }
}

async function startBrowser(options = {}) {
    const config = {
        ...DEFAULT_OPTIONS,
        ...options,
        viewport: {
            ...DEFAULT_OPTIONS.viewport,
            ...(options.viewport || {})
        }
    };

    const sessionPath = path.resolve(config.sessionPath || SESSION_PATH);

    let browser;

    try {
        assertSessionExists(sessionPath);

     browser = await chromium.launch({
    channel: config.channel,
    headless: config.headless,
    slowMo: config.slowMo,
    args: ["--start-maximized"],
    ...(config.launchOptions || {})
});
        const context = await browser.newContext({
            storageState: sessionPath,
viewport: null,
            ...(config.contextOptions || {})
        });

        const page = await context.newPage();

        if (config.authCheck) {
            await assertLinkedInAuthenticated(
                page,
                config.navigationTimeout
            );
        }

        return {
            browser,
            context,
            page
        };
    } catch (err) {
        if (browser) {
            await browser.close().catch(() => {});
        }

        throw new Error("Browser startup failed: " + err.message);
    }
}

module.exports = startBrowser;
module.exports.SESSION_PATH = SESSION_PATH;
