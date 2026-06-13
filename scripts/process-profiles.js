const fs = require('fs');
const csv = require('csv-parser');
const startBrowser = require('../services/browser');

async function checkProfile(page, url) {

    await page.goto(url, {
        waitUntil: 'domcontentloaded'
    });

    await page.waitForTimeout(5000);

    // Connect available
    const connectLink = page
        .locator('a[href*="/preload/custom-invite/"]')
        .filter({ hasText: 'Connect' });

    if (await connectLink.count() > 0) {
        return 'connect_available';
    }

    // Follow button visible
    const followButton = page
        .locator('text=Follow');

    if (await followButton.count() > 0) {
        return 'follow_only';
    }

    // Message button visible
    const messageButton = page
        .locator('text=Message');

    if (await messageButton.count() > 0) {
        return 'connected_or_open_profile';
    }

    return 'unknown';
}

(async () => {

    const rows = [];

    fs.createReadStream('./data/profiles.csv')
        .pipe(csv())
        .on('data', row => rows.push(row))
        .on('end', async () => {

            const { browser, page } =
                await startBrowser();

            console.log(
                `Processing ${rows.length} profiles...\n`
            );

            for (const row of rows) {

                try {

                    const status =
                        await checkProfile(
                            page,
                            row.url
                        );

                    console.log(
                        `${row.url} -> ${status}`
                    );

                } catch (err) {

                    console.log(
                        `${row.url} -> ERROR`
                    );

                    console.log(err.message);
                }
            }

            await browser.close();

        });

})();