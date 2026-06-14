const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();
    
await page.goto(
    'https://www.linkedin.com/feed/',
    { waitUntil: 'domcontentloaded' }
);

    console.log(
        'URL:',
        page.url()
    );

    console.log(
        'TITLE:',
        await page.title()
    );

    await page.waitForTimeout(10000);

    await browser.close();

})();