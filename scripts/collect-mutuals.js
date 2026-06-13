const fs = require('fs');
const startBrowser = require('../services/browser');

(async () => {

    const { browser, page } = await startBrowser();

    try {

        console.log('Opening LinkedIn search...');

        await page.goto(
            'https://www.linkedin.com/search/results/people/',
            {
                waitUntil: 'domcontentloaded'
            }
        );

        console.log('');
        console.log('MANUAL STEP REQUIRED');
        console.log('====================');
        console.log('1. Apply the Gurupreet Singh mutual connection filter');
        console.log('2. Wait until results are visible');
        console.log('3. Press ENTER here');
        console.log('');

        process.stdin.once('data', async () => {

            await page.waitForTimeout(3000);

            const links = await page
                .locator('a')
                .evaluateAll(els =>
                    els
                        .map(a => a.href)
                        .filter(
                            href =>
                                href &&
                                href.includes('/in/')
                        )
                );

            const profiles = [
                ...new Set(
                    links.map(
                        x => x.split('?')[0]
                    )
                )
            ];

            console.log('');
            console.log(
                'Profiles Found:',
                profiles.length
            );

            fs.writeFileSync(
                './data/mutuals.json',
                JSON.stringify(
                    profiles,
                    null,
                    2
                )
            );

            console.log(
                'Saved: data/mutuals.json'
            );

            await browser.close();

        });

    } catch (err) {

        console.error(err);

        await browser.close();

    }

})();