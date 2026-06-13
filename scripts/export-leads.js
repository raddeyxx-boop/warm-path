const fs = require('fs');
const csv = require('csv-parser');
const startBrowser = require('../services/browser');

async function scrapeProfile(page, profileUrl) {

    await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded'
    });

    await page.waitForTimeout(5000);

    const pageText = await page
        .locator('main')
        .textContent();

    const profile = {
        url: profileUrl,
        name: '',
        pronouns: '',
        headline: '',
        companyEducation: '',
        location: '',
        status: 'unknown'
    };

    // Pronouns
    const pronounMatch = pageText.match(
        /(He\/Him|She\/Her|They\/Them)/i
    );

    if (pronounMatch) {
        profile.pronouns = pronounMatch[1];
    }

    // Headline
    const headlineMatch = pageText.match(
        /(Founder\s*&\s*CEO.*?)(Indpro\s*·)/i
    );

    if (headlineMatch) {
        profile.headline =
            headlineMatch[1].trim();
    }

    // Company + Education
    const companyMatch = pageText.match(
        /(Indpro\s*·\s*Uppsala University)/i
    );

    if (companyMatch) {
        profile.companyEducation =
            companyMatch[1].trim();
    }

    // Location
    const locationMatch = pageText.match(
        /([A-Za-zÀ-ÿ\s]+,\s*[A-Za-zÀ-ÿ\s]+,\s*Sweden)/
    );

    if (locationMatch) {
        profile.location =
            locationMatch[1].trim();
    }

    // Status
    const connectLink = page
        .locator('a[href*="/preload/custom-invite/"]')
        .filter({ hasText: 'Connect' });

    if (await connectLink.count() > 0) {

        profile.status =
            'connect_available';

    } else {

        const followBtn =
            page.locator('text=Follow');

        if (await followBtn.count() > 0) {

            profile.status =
                'follow_only';

        } else {

            const messageBtn =
                page.locator('text=Message');

            if (await messageBtn.count() > 0) {

                profile.status =
                    'connected_or_message_available';
            }
        }
    }

    return profile;
}

(async () => {

    const rows = [];

    fs.createReadStream('./data/profiles.csv')
        .pipe(csv())
        .on('data', row => rows.push(row))
        .on('end', async () => {

            const { browser, page } =
                await startBrowser();

            const results = [];

            for (const row of rows) {

                try {

                    console.log(
                        `Processing: ${row.url}`
                    );

                    const profile =
                        await scrapeProfile(
                            page,
                            row.url
                        );

                    results.push(profile);

                } catch (err) {

                    console.log(
                        `ERROR: ${row.url}`
                    );

                    console.log(err.message);
                }
            }

            const header =
                'url,name,pronouns,headline,companyEducation,location,status\n';

            const csvRows =
                results.map(profile => {

                    return [
                        profile.url,
                        `"${profile.name}"`,
                        `"${profile.pronouns}"`,
                        `"${profile.headline}"`,
                        `"${profile.companyEducation}"`,
                        `"${profile.location}"`,
                        `"${profile.status}"`
                    ].join(',');

                }).join('\n');

            fs.writeFileSync(
                './data/leads.csv',
                header + csvRows
            );

            console.log(
                '\nExport Complete'
            );

            console.log(
                `Leads: ${results.length}`
            );

            await browser.close();

        });

})();