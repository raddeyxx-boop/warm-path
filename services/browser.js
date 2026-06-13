const { chromium } = require('playwright');

async function startBrowser() {
    const browser = await chromium.launch({
        headless: false
    });

    const context = await browser.newContext({
        storageState: './sessions/linkedin.json'
    });

    const page = await context.newPage();

    return {
        browser,
        context,
        page
    };
}

module.exports = startBrowser;