const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    await page.goto(
        'https://www.linkedin.com/in/gurupreet-singh-2344aa2bb/',
        {
            waitUntil: 'domcontentloaded'
        }
    );

    await page.waitForTimeout(5000);

    const text = await page
        .locator('main')
        .textContent();

    console.log('PAGE LOADED');
    console.log('Length:', text.length);

    console.log(
        text.substring(0, 2000)
    );

    await browser.close();

})();