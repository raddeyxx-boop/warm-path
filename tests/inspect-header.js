const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    await page.goto(
        'https://www.linkedin.com/in/pavelsiddique/',
        {
            waitUntil: 'domcontentloaded'
        }
    );

    await page.waitForTimeout(5000);

    const text = await page.locator('main').textContent();

    console.log(
        text.substring(0, 3000)
    );

    await browser.close();

})();