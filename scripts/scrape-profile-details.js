const startBrowser = require('../services/browser');

async function scrapeProfile(profileUrl) {

    const { browser, page } = await startBrowser();

    try {

        console.log('Opening profile...');
        console.log(profileUrl);

        await page.goto(profileUrl, {
            waitUntil: 'domcontentloaded'
        });

        await page.waitForTimeout(5000);

        const pageText = await page.locator('main').textContent();

        const profile = {
            url: profileUrl,
            name: '',
            pronouns: '',
            headline: '',
            companyEducation: '',
            location: '',
            status: 'unknown'
        };

        // Name
        const nameMatch = pageText.match(
            /^([A-Z][A-Za-zÀ-ÿ\s.'-]+?)(He\/Him|She\/Her|They\/Them|Founder|CEO|Director)/i
        );

        if (nameMatch) {
            profile.name = nameMatch[1].trim();
        }

        // Pronouns
        const pronounMatch = pageText.match(
            /(He\/Him|She\/Her|They\/Them)/i
        );

        if (pronounMatch) {
            profile.pronouns = pronounMatch[1];
        }

        // Location
        const locationMatch = pageText.match(
            /([A-Za-zÀ-ÿ\s]+,\s*[A-Za-zÀ-ÿ\s]+,\s*Sweden)/
        );

        if (locationMatch) {
            profile.location = locationMatch[1].trim();
        }

        // Headline
        const headlineMatch = pageText.match(
            /(Founder\s*&\s*CEO.*?)(Indpro\s*·)/i
        );

        if (headlineMatch) {
            profile.headline = headlineMatch[1].trim();
        }

        // Company + Education
        const companyMatch = pageText.match(
            /(Indpro\s*·\s*Uppsala University)/i
        );

        if (companyMatch) {
            profile.companyEducation = companyMatch[1].trim();
        }

        // Relationship Status
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

                    profile.status =
                        'connected_or_message_available';
                }
            }
        }

        console.log('\nPROFILE DATA');
        console.log('====================');
        console.log(JSON.stringify(profile, null, 2));

    } catch (err) {

        console.error(err);

    } finally {

        await browser.close();
    }
}

scrapeProfile(
    'https://www.linkedin.com/in/pavelsiddique/'
);