const fs = require('fs');
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

    const profiles = new Set();

    for (let i = 0; i < count; i++) {

        const href = await links.nth(i).getAttribute('href');

        if (!href) continue;

        if (!href.includes('/in/')) continue;

        const cleanUrl =
            href.split('?')[0];

        profiles.add(cleanUrl);
    }

    const results = [...profiles];

    console.log(results);

    fs.writeFileSync(
        './data/found-profiles.json',
        JSON.stringify(results, null, 2)
    );

    await browser.close();

})();