const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    await page.goto(
        'https://www.linkedin.com/in/example-profile/',
        {
            waitUntil: 'domcontentloaded'
        }
    );

    await page.waitForTimeout(5000);

    const connectLink = page
        .locator('a[href*="/preload/custom-invite/"]')
        .filter({ hasText: 'Connect' })
        .first();

    console.log(
        'Found:',
        await connectLink.count()
    );

    await connectLink.click();

    await page.waitForTimeout(5000);

    await browser.close();

})();