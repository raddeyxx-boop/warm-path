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

async function scrapeProfile(page, profileUrl, cache) {
    const cached = getCachedEntry(profileUrl, cache);

    if (cached) {
        console.log(`Cached result for ${profileUrl}`);
        return { ...cached, cached: true };
    }

    try {
        await safeGoto(page, profileUrl, {
            retries: 3,
            initialDelay: 5000,
            maxDelay: 15000
        });

        await sleep(3000, 6000);

        const pageText = (await page.locator('main').textContent()) || '';

        const profile = {
            url: profileUrl,
            name: '',
            pronouns: '',
            headline: '',
            companyEducation: '',
            location: '',
            status: 'unknown'
        };

        const pronounMatch = pageText.match(
            /(He\/Him|She\/Her|They\/Them)/i
        );

        if (pronounMatch) {
            profile.pronouns = pronounMatch[1];
        }

        const headlineMatch = pageText.match(
            /(Founder\s*&\s*CEO.*?)(Indpro\s*·)/i
        );

        if (headlineMatch) {
            profile.headline = headlineMatch[1].trim();
        }

        const companyMatch = pageText.match(
            /(Indpro\s*·\s*Uppsala University)/i
        );

        if (companyMatch) {
            profile.companyEducation = companyMatch[1].trim();
        }

        const locationMatch = pageText.match(
            /([A-Za-zÀ-ÿ\s]+,\s*[A-Za-zÀ-ÿ\s]+,\s*Sweden)/
        );

        if (locationMatch) {
            profile.location = locationMatch[1].trim();
        }

        const connectLink = page
            .locator('a[href*="/preload/custom-invite/"]')
            .filter({ hasText: 'Connect' });

        if (await connectLink.count() > 0) {
            profile.status = 'connect_available';
        } else {
            const followBtn = page.locator('text=Follow');

            if (await followBtn.count() > 0) {
                profile.status = 'follow_only';
            } else {
                const messageBtn = page.locator('text=Message');

                if (await messageBtn.count() > 0) {
                    profile.status = 'connected_or_message_available';
                }
            }
        }

        setCachedEntry(profileUrl, profile, cache);
        saveCache(cache, 'profile-cache');

        return profile;
    } catch (err) {
        if (err.blocked) {
            console.error('Blocked or rate-limited while scraping:', profileUrl);
            throw err;
        }

        console.error('Scrape failed for:', profileUrl, '-', err.message);
        throw err;
    }
}

(async () => {
    const rows = [];
    const cache = loadCache('profile-cache');
    const profileLimit = parsePositiveInteger(process.env.PROFILE_LIMIT, 0);
    const batchSize = parsePositiveInteger(process.env.BATCH_SIZE, 3);
    let consecutiveFailures = 0;
    let stopped = false;

    fs.createReadStream('./data/profiles.csv')
        .pipe(csv())
        .on('data', row => rows.push(row))
        .on('end', async () => {
            const { browser, page } = await startBrowser();
            const results = [];
            const selectedRows = profileLimit > 0 ? rows.slice(0, profileLimit) : rows;
            const batches = batchArray(selectedRows, batchSize);

            console.log(`Processing ${selectedRows.length} profiles in ${batches.length} batch(es).`);

            for (const batch of batches) {
                for (const row of batch) {
                    console.log(`\nProcessing: ${row.url}`);

                    try {
                        const profile = await scrapeProfile(page, row.url, cache);
                        results.push(profile);
                        consecutiveFailures = 0;
                    } catch (err) {
                        consecutiveFailures += 1;
                        results.push({
                            url: row.url,
                            name: '',
                            pronouns: '',
                            headline: '',
                            companyEducation: '',
                            location: '',
                            status: 'error'
                        });

                        console.error(`ERROR: ${row.url}`);
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

                console.log('Batch complete. Pausing between batches.');
                await sleep(8000, 12000);
            }

            const header = 'url,name,pronouns,headline,companyEducation,location,status\n';
            const csvRows = results.map(profile => {
                return [
                    profile.url,
                    `"${(profile.name || '').replace(/"/g, '""')}"`,
                    `"${(profile.pronouns || '').replace(/"/g, '""')}"`,
                    `"${(profile.headline || '').replace(/"/g, '""')}"`,
                    `"${(profile.companyEducation || '').replace(/"/g, '""')}"`,
                    `"${(profile.location || '').replace(/"/g, '""')}"`,
                    `"${profile.status}"`
                ].join(',');
            }).join('\n');

            fs.writeFileSync('./data/leads.csv', header + csvRows, 'utf8');

            console.log('\nExport Complete');
            console.log(`Leads: ${results.length}`);

            await browser.close();
        });
})();