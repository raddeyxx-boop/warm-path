// visit-profile.js

const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    const profileUrl =
        'https://www.linkedin.com/in/example-profile/';

    await page.goto(
        profileUrl,
        { waitUntil: 'domcontentloaded' }
    );

    await page.waitForTimeout(5000);

    console.log('Visited:', page.url());

    await browser.close();

})();