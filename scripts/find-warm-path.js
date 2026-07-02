const fs = require('fs');
const startBrowser =
    require('../services/browser');

const {
    collectProfileInfo,
    collectPostLinks
} = require('../services/warm-path-service');

async function findWarmPath() {

    const { browser, page } =
        await startBrowser();

    try {

        console.log(
            'Opening profile...'
        );

        const target = require('../data/target.json');

        if (!target.url) {
            throw new Error('data/target.json must include a LinkedIn profile URL.');
        }

        await page.goto(
            target.url,
            {
                waitUntil: 'domcontentloaded'
            }
        );

        await page.waitForTimeout(
            5000
        );

        const profile =
            await collectProfileInfo(
                page
            );

        console.log(
            '\nPROFILE'
        );

        console.log(profile);

        const postLinks =
            await collectPostLinks(
                page
            );

        console.log(
            '\nPOSTS FOUND:',
            postLinks.length
        );

        const csv = [
            'post_url'
        ];

        for (
            const link
            of postLinks
        ) {
            csv.push(link);
        }

        fs.writeFileSync(
            './data/warm-path.csv',
            csv.join('\n')
        );

        console.log(
            '\nSaved: data/warm-path.csv'
        );

    } catch (err) {

        console.error(
            err.message
        );

    } finally {

        await browser.close();
    }
}

findWarmPath();
