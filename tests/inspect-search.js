const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    await page.goto(
        'https://www.linkedin.com/search/results/people/?keywords=Pavel%20Siddique',
        {
            waitUntil: 'domcontentloaded'
        }
    );

    await page.waitForTimeout(8000);

    const links = page.locator('a');

    const count = await links.count();

    console.log('Links:', count);

    for (let i = 0; i < Math.min(count, 100); i++) {

        const href = await links.nth(i).getAttribute('href');

        if (
            href &&
            href.includes('/in/')
        ) {
            console.log(href);
        }
    }

    await browser.close();

})();