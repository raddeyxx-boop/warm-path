const fs = require('fs');
const startBrowser = require('../services/browser');

function scoreProfile(profile) {

    let score = 0;

    const text = (
        profile.headline +
        ' ' +
        profile.company +
        ' ' +
        profile.location
    ).toLowerCase();

    if (text.includes('indpro')) score += 50;

    if (
        text.includes('manager') ||
        text.includes('lead') ||
        text.includes('director')
    ) score += 20;

    if (
        text.includes('founder') ||
        text.includes('ceo')
    ) score += 25;

    if (
        text.includes('sales') ||
        text.includes('marketing') ||
        text.includes('business development')
    ) score += 10;

    if (
        text.includes('bengaluru') ||
        text.includes('bangalore')
    ) score += 5;

    return score;
}

async function scrapeProfile(page, url) {

    try {

        await page.goto(url, {
            waitUntil: 'domcontentloaded'
        });

        await page.waitForTimeout(4000);

        const text = await page
            .locator('main')
            .textContent();

        const lines = text
            .split('\n')
            .map(x => x.trim())
            .filter(Boolean);

        return {
            url,
            name: lines[0] || '',
            headline: lines[2] || '',
            company: lines[3] || '',
            location: lines[4] || ''
        };

    } catch {

        return {
            url,
            name: '',
            headline: '',
            company: '',
            location: ''
        };
    }
}

(async () => {

    const urls = JSON.parse(
        fs.readFileSync(
            './data/mutuals.json',
            'utf8'
        )
    );

    const { browser, page } =
        await startBrowser();

    const results = [];

    for (const url of urls) {

        console.log(
            'Checking:',
            url
        );

        const profile =
            await scrapeProfile(
                page,
                url
            );

        profile.score =
            scoreProfile(profile);

        results.push(profile);
    }

    results.sort(
        (a, b) =>
            b.score - a.score
    );

    const csv = [
        'name,company,location,score,url'
    ];

    for (const r of results) {

        csv.push(
            `"${r.name.replace(/"/g,'')}",` +
            `"${r.company.replace(/"/g,'')}",` +
            `"${r.location.replace(/"/g,'')}",` +
            `${r.score},` +
            `"${r.url}"`
        );
    }

    fs.writeFileSync(
        './data/ranked-mutuals.csv',
        csv.join('\n')
    );

    console.log('');
    console.log(
        'Saved: data/ranked-mutuals.csv'
    );

    await browser.close();

})();