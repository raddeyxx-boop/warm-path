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

    const connects = page.locator('text=Connect');

    console.log('Clicking match #2');

    await connects.nth(2).click();

    await page.waitForTimeout(10000);

    await browser.close();

})();