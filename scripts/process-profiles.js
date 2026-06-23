const fs = require('fs');
const csv = require('csv-parser');
const startBrowser = require('../services/browser');
const {
    batchArray,
    getCachedEntry,
    loadCache,
    parsePositiveInteger,
    safeGoto,
    saveCache,
    setCachedEntry
} = require('../services/scrape-utils');
const { sleep } = require('../utils/delay');

async function checkProfile(page, url, cache) {
    const cached = getCachedEntry(url, cache);
    if (cached) {
        console.log(`Cached status for ${url}`);
        return cached;
    }

    await safeGoto(page, url, {
        retries: 3,
        initialDelay: 4000,
        maxDelay: 15000
    });

    await sleep(3000, 5000);

    const connectLink = page
        .locator('a[href*="/preload/custom-invite/"]')
        .filter({ hasText: 'Connect' });

    if (await connectLink.count() > 0) {
        return 'connect_available';
    }

    const followButton = page
        .locator('text=Follow');

    if (await followButton.count() > 0) {
        return 'follow_only';
    }

    const messageButton = page
        .locator('text=Message');

    if (await messageButton.count() > 0) {
        return 'connected_or_open_profile';
    }

    return 'unknown';
}

(async () => {
    const rows = [];
    const cache = loadCache('profile-cache');
    const profileLimit = parsePositiveInteger(process.env.PROFILE_LIMIT, 0);
    const batchSize = parsePositiveInteger(process.env.BATCH_SIZE, 4);
    let consecutiveFailures = 0;
    let stopped = false;

    fs.createReadStream('./data/profiles.csv')
        .pipe(csv())
        .on('data', row => rows.push(row))
        .on('end', async () => {
            const { browser, page } = await startBrowser();
            const selectedRows = profileLimit > 0 ? rows.slice(0, profileLimit) : rows;
            const batches = batchArray(selectedRows, batchSize);

            console.log(`Processing ${selectedRows.length} profiles in ${batches.length} batch(es)...\n`);

            for (const batch of batches) {
                for (const row of batch) {
                    try {
                        const status = await checkProfile(page, row.url, cache);
                        setCachedEntry(row.url, status, cache);
                        saveCache(cache, 'profile-cache');
                        consecutiveFailures = 0;

                        console.log(`${row.url} -> ${status}`);
                    } catch (err) {
                        consecutiveFailures += 1;
                        console.error(`${row.url} -> ERROR`);
                        console.error(err.message);

                        if (err.blocked || consecutiveFailures >= 3) {
                            console.error('Stopping due to repeated failures or blocking.');
                            stopped = true;
                            break;
                        }
                    }

                    await sleep(5000, 9000);
                }

                if (stopped || consecutiveFailures >= 3) {
                    break;
                }

                console.log('Batch complete. Pausing before next batch.');
                await sleep(8000, 12000);
            }

            await browser.close();
        });
})();