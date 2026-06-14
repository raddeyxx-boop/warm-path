const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    await page.goto(
        'https://www.linkedin.com/in/rahul-bothra-0231608/',
        {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        }
    );

    await page.waitForTimeout(5000);

    const text =
        await page.locator('body').textContent();

    console.log(
        text.substring(0,1500)
    );

    await browser.close();

})();