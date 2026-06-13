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

    const bodyText = await page.locator('body').textContent();

    const lines = bodyText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    console.log(lines.slice(0, 20));

    await browser.close();

})();