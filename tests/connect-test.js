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

    await connects.nth(2).click();

    console.log('Invitation dialog opened');

    await page.waitForSelector(
        'text=Add a note'
    );

    console.log('Dialog detected');

    await page.keyboard.press('Escape');

    console.log('Dialog closed');

    await page.waitForTimeout(2000);

    await browser.close();

})();