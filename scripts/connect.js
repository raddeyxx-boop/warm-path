const startBrowser = require('../services/browser');
const { resilientClick } = require('../services/playwright-actions');
const { safeGoto } = require('../services/scrape-utils');

async function connectToProfile(profileUrl) {

    const { browser, page } = await startBrowser();

    try {

        console.log('Opening profile...');
        console.log(profileUrl);

        await safeGoto(page, profileUrl, { retries: 3 });

        await page.waitForTimeout(5000);

        const connectLink = page.getByRole('button', { name: /^connect$/i })
            .or(page.getByRole('link', { name: /^connect$/i }))
            .or(page.locator('a[href*="/preload/custom-invite/"]').filter({ hasText: /^Connect$/i }))
            .first();

        const connectCount = await connectLink.count();

        if (connectCount === 0) {
            throw new Error('Connect button not found');
        }

        console.log('Connect button found');

        await resilientClick(connectLink, {
            context: 'connect.connectToProfile',
            page,
            timeout: 7000,
            pauseBeforeClick: () => page.waitForTimeout(1000)
        });

        console.log('Connect clicked');

        const sendBtn = page.locator(
            'text=Send without a note'
        );

        await sendBtn.waitFor({
            timeout: 10000
        });

        console.log('Invitation dialog ready');

        // TEST MODE ONLY
        console.log('READY TO SEND');
        console.log('NOT SENDING (TEST MODE)');

        // Close the dialog
        await page.keyboard.press('Escape');

        console.log('Dialog closed');

        await page.waitForTimeout(2000);

    } catch (err) {

        console.error('ERROR:', err.message);
        throw err;

    } finally {

        await browser.close().catch(closeError => {
            console.error('[connect.js:connectToProfile] Browser cleanup failed:', closeError.message);
        });
    }
}

if (require.main === module) {
    const profileUrl = process.argv[2];

    if (!profileUrl) {
        console.error('Usage: node scripts/connect.js "https://www.linkedin.com/in/profile/"');
        process.exitCode = 1;
    } else {
        connectToProfile(profileUrl).catch(() => {
            process.exitCode = 1;
        });
    }
}

module.exports = {
    connectToProfile
};
