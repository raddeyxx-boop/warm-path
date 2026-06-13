const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    await page.goto(
        'https://www.linkedin.com/in/pavelsiddique/',
        {
            waitUntil: 'domcontentloaded'
        }
    );

    await page.waitForTimeout(5000);

    const buttons = page.locator('button');

    const count = await buttons.count();

    console.log('Buttons:', count);

    for (let i = 0; i < count; i++) {

        const text = await buttons.nth(i).textContent();

        if (text && text.trim()) {
            console.log(i, text.trim());
        }
    }

    await browser.close();

})();