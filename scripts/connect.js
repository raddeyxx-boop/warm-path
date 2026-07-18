const startBrowser = require('../services/browser');

async function connectToProfile(profileUrl) {

    const { browser, page } = await startBrowser();

    try {

        console.log('Opening profile...');
        console.log(profileUrl);

        await page.goto(profileUrl, {
            waitUntil: 'domcontentloaded'
        });

        await page.waitForTimeout(5000);

        const connectLink = page
            .locator('a[href*="/preload/custom-invite/"]')
            .filter({ hasText: 'Connect' })
            .first();

        const connectCount = await connectLink.count();

        if (connectCount === 0) {
            throw new Error('Connect button not found');
        }

        console.log('Connect button found');

        await connectLink.scrollIntoViewIfNeeded();

        await page.waitForTimeout(1000);

        try {

            await connectLink.click({
                force: true
            });

        } catch {

            console.log(
                'Normal click failed, using DOM click...'
            );

            await connectLink.evaluate(el => el.click());
        }

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

        await browser.close();
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
