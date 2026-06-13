// verify.js

const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    await page.goto(
        'https://www.linkedin.com/feed/',
        { waitUntil: 'domcontentloaded' }
    );

    console.log('Current URL:', page.url());

    if (page.url().includes('/feed')) {
        console.log('SESSION VALID');
    } else {
        console.log('SESSION EXPIRED');
    }

    await browser.close();

})();