const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    const query = encodeURIComponent('Pavel Siddique');

    await page.goto(
        `https://www.linkedin.com/search/results/people/?keywords=${query}`,
        {
            waitUntil: 'domcontentloaded'
        }
    );

    await page.waitForTimeout(8000);

    console.log('URL:', page.url());

    const bodyText = await page.locator('body').textContent();

    console.log(
        bodyText.substring(0, 3000)
    );

    await browser.close();

})();