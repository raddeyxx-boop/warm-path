const startBrowser = require('../services/browser');

async function scrapeProfile(profileUrl) {
    const { browser, page } = await startBrowser();

    try {
        console.log('\n=================================');
        console.log('Opening profile...');
        console.log(profileUrl);
        console.log('=================================\n');

        await page.goto(profileUrl, {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        await page.waitForTimeout(5000);

        const profile = {
            linkedin_url: profileUrl,
            name: '',
            headline: '',
            company: '',
            location: '',
            about: '',
            status: 'unknown'
        };

        const pageText =
            (await page.locator('main').textContent()) || '';

        const lines = pageText
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        console.log('\nFIRST 30 LINES');
        console.log('====================');
        console.log(lines.slice(0, 30));

        // =====================================
        // NAME
        // =====================================
        try {
            const h1 = await page.locator('h1').first().textContent();

            if (h1) {
                profile.name = h1.trim();
            }
        } catch {}

        if (!profile.name && lines.length > 0) {
            profile.name = lines[0];
        }

        // =====================================
        // HEADLINE
        // =====================================
        try {
            const headlineSelectors = [
                '.text-body-medium',
                '.pv-text-details__left-panel div.text-body-medium',
            ];

            for (const selector of headlineSelectors) {
                const locator = page.locator(selector);

                if (await locator.count()) {
                    const text = (
                        await locator.first().textContent()
                    )?.trim();

                    if (text) {
                        profile.headline = text;
                        break;
                    }
                }
            }
        } catch {}

        if (!profile.headline) {
            const idx = lines.findIndex(
                line =>
                    profile.name &&
                    line.includes(profile.name)
            );

            if (idx >= 0 && lines[idx + 1]) {
                profile.headline = lines[idx + 1];
            }
        }

        // =====================================
        // LOCATION
        // =====================================
        try {
            const locationPatterns = [
                /[A-Za-z\s]+,\s*[A-Za-z\s]+,\s*[A-Za-z\s]+/,
                /Greater\s+[A-Za-z\s]+\s+Area/,
                /[A-Za-z\s]+,\s*India/,
                /[A-Za-z\s]+,\s*Sweden/,
                /[A-Za-z\s]+,\s*USA/
            ];

            for (const line of lines) {
                for (const pattern of locationPatterns) {
                    if (pattern.test(line)) {
                        profile.location = line;
                        break;
                    }
                }

                if (profile.location) break;
            }
        } catch {}

        // =====================================
        // COMPANY
        // =====================================
        try {
            if (profile.headline) {
                const atMatch = profile.headline.match(
                    /\bat\s+(.+)$/i
                );

                if (atMatch) {
                    profile.company = atMatch[1].trim();
                }
            }

            if (!profile.company) {
                const experienceIndex = lines.findIndex(
                    line =>
                        line.toLowerCase() === 'experience'
                );

                if (
                    experienceIndex >= 0 &&
                    lines[experienceIndex + 2]
                ) {
                    profile.company =
                        lines[experienceIndex + 2];
                }
            }
        } catch {}

        // =====================================
        // ABOUT
        // =====================================
        try {
            const aboutIndex = lines.findIndex(
                line =>
                    line.toLowerCase() === 'about'
            );

            if (
                aboutIndex >= 0 &&
                lines[aboutIndex + 1]
            ) {
                profile.about = lines
                    .slice(
                        aboutIndex + 1,
                        aboutIndex + 6
                    )
                    .join(' ');
            }
        } catch {}

        // =====================================
        // CONNECTION STATUS
        // =====================================
        try {
            if (
                await page
                    .getByRole('button', {
                        name: /connect/i
                    })
                    .count()
            ) {
                profile.status =
                    'connect_available';
            } else if (
                await page
                    .getByRole('button', {
                        name: /message/i
                    })
                    .count()
            ) {
                profile.status =
                    'connected_or_message_available';
            } else if (
                await page
                    .getByRole('button', {
                        name: /follow/i
                    })
                    .count()
            ) {
                profile.status = 'follow_only';
            }
        } catch {}

        console.log('\nPROFILE DATA');
        console.log('====================');
        console.log(JSON.stringify(profile, null, 2));

        return profile;

    } catch (err) {
        console.error('\nSCRAPE ERROR');
        console.error(err);
        return null;
    } finally {
        await browser.close();
    }
}

scrapeProfile(
    'https://www.linkedin.com/in/pavelsiddique/'
);