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

    const connects = page.locator('text=Connect');

    await connects.nth(2).click();

    await page.waitForTimeout(2000);

    const sendBtn = page.locator('text=Send without a note');

    console.log(
        'Send button count:',
        await sendBtn.count()
    );

    const noteBtn = page.locator('text=Add a note');

    console.log(
        'Note button count:',
        await noteBtn.count()
    );

    await page.keyboard.press('Escape');

    await browser.close();

})();