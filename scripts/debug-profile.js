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

    await page.waitForTimeout(8000);

    const selectors = [
        'h1',
        '.text-body-medium',
        '.text-body-small',
        '.pv-top-card',
        '.pv-text-details__left-panel',
        '.artdeco-card',
        'main'
    ];

    for (const selector of selectors) {

        try {

            const count =
                await page.locator(selector).count();

            console.log('');
            console.log('SELECTOR:', selector);
            console.log('COUNT:', count);

            if (count > 0) {

                const text =
                    await page
                        .locator(selector)
                        .first()
                        .textContent();

                console.log(
                    text.substring(0, 2000)
                );
            }

        } catch (e) {
            console.log(e.message);
        }
    }

    await browser.close();

})();
