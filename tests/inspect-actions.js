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

    const links = await page.locator('a').all();

    console.log('Links:', links.length);

    for (let i = 0; i < Math.min(100, links.length); i++) {

        const text = await links[i].textContent();

        if (text && text.includes('Connect')) {
            console.log('LINK:', i, text);
        }
    }

    await browser.close();

})();