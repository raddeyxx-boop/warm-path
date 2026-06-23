const fs = require('fs');
const startBrowser = require('../services/browser');
const {
    batchArray,
    getCachedEntry,
    isFatalError,
    loadCache,
    parsePositiveInteger,
    safeGoto,
    saveCache,
    setCachedEntry
} = require('../services/scrape-utils');
const { sleep } = require('../utils/delay');

function scoreProfile(profile) {

    let score = 0;

    const text = (
        profile.name +
        ' ' +
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
        text.includes('business development') ||
        text.includes('recruiter') ||
        text.includes('talent acquisition')
    ) score += 10;

    if (
        text.includes('bengaluru') ||
        text.includes('bangalore')
    ) score += 5;

    return score;
}

async function scrapeProfile(page, url, cache) {

    const cached = getCachedEntry(url, cache);

    if (cached) {
        console.log('Cached profile for ' + url);
        return { ...cached, cached: true };
    }

    try {

        await safeGoto(page, url, {
            retries: 3,
            initialDelay: 5000,
            maxDelay: 20000
        });

        await page.waitForLoadState('networkidle')
            .catch(() => {});

        await sleep(4000, 7000);

        const profile = await page.evaluate(() => {

            const clean = text =>
                (text || '')
                    .replace(/\s+/g, ' ')
                    .trim();

            const getText = selector =>
                clean(document.querySelector(selector)?.innerText);

            const isVisible = el => {
                const style = window.getComputedStyle(el);

                return (
                    style &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    el.getClientRects().length > 0
                );
            };

            const badTexts = new Set([
                'Try Premium for Rs.0',
                'Try Premium for 0',
                'Message',
                'Connect',
                'Follow',
                'More',
                'Show all',
                'Notifications',
                'Jobs',
                'Home',
                'My Network',
                'For Business',
                'Contact info'
            ]);

            const roleRegex =
                /\b(at|founder|co-founder|ceo|cto|cfo|coo|director|manager|engineer|recruiter|specialist|president|lead|officer|consultant|advisor|head|partner|owner)\b/i;

            const locationRegex =
                /^(?:(Bengaluru|Bangalore|Mumbai|Delhi|Hyderabad|Pune|Chennai|Gurugram|Gurgaon|Noida|Ahmedabad|Kolkata),\s*[A-Z][A-Za-z .'-]+,\s*(India|Sweden|United States|USA|UK|Singapore)|(Bengaluru|Bangalore|Mumbai|Delhi|Hyderabad|Pune|Chennai|Gurugram|Gurgaon|Noida|Ahmedabad|Kolkata),?\s*(India)?)$/i;

            const companySeparators = [
                'Connect',
                'Message',
                'Follow',
                'Contact info'
            ];

            const visibleTexts = [
                ...document.querySelectorAll(
                    'main h1, main span, main div.text-body-medium, main div.text-body-small'
                )
            ]
                .filter(isVisible)
                .map(el => clean(el.innerText))
                .filter(Boolean)
                .filter(text => !badTexts.has(text));

            const uniqueTexts = [];

            for (const text of visibleTexts) {
                if (!uniqueTexts.includes(text)) {
                    uniqueTexts.push(text);
                }
            }

            const mainText =
                clean(document.querySelector('main')?.innerText);

            let name =
                getText('main h1') ||
                getText('h1');

            let headline = '';
            let company = '';
            let location = '';

            for (let i = 0; i < uniqueTexts.length; i++) {
                const current = uniqueTexts[i];
                const next = uniqueTexts[i + 1] || '';

                if (!name && current.length > 3 && current.length < 80 && roleRegex.test(next)) {
                    name = current;
                    headline = next;
                    break;
                }

                if (name && current === name && roleRegex.test(next)) {
                    headline = next;
                    break;
                }
            }

            if (!headline) {
                headline =
                    uniqueTexts.find(text => roleRegex.test(text) && text !== name) || '';
            }

            location =
                uniqueTexts.find(text => locationRegex.test(text)) || '';

            if (!location && mainText) {
                const locationMatch = mainText.match(
                    /([A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+,\s*(?:India|Sweden|United States|USA|UK|Singapore))/
                );

                location = clean(locationMatch?.[1]);
            }

            if (location) {
                const locationIndex = uniqueTexts.indexOf(location);

                if (locationIndex > 0) {
                    company = uniqueTexts[locationIndex - 1];
                }
            }

            if (!company && headline && mainText) {
                const afterHeadline =
                    mainText.split(headline)[1] || '';

                const beforeLocation = location
                    ? afterHeadline.split(location)[0]
                    : afterHeadline;

                company = clean(
                    companySeparators.reduce(
                        (text, separator) => text.split(separator)[0],
                        beforeLocation
                    )
                );
            }

            if (company === headline || badTexts.has(company)) {
                company = '';
            }

            if (
                /^[•·]|\b(1st|2nd|3rd|Messaging|Visit my website|Show details|\d+\s*(mo|yr|d|h)\s*•|Institute|University|College|School)\b/i
                    .test(name)
            ) {
                name = '';
            }

            if (location && (!locationRegex.test(location) || location.length > 90)) {
                location = '';
            }

            if (company && locationRegex.test(company.replace(/[·\s]+$/g, ''))) {
                company = '';
            }

            if ((!name || !headline || !location) && mainText) {
                const headerEndMatch =
                    mainText.match(/\b(Activity|Posts|Experience|About)\b/i);

                let headerText = clean(
                    headerEndMatch
                        ? mainText.slice(0, headerEndMatch.index)
                        : mainText
                );

                headerText = clean(
                    headerText.replace(
                        /^(Messaging|Skip to main content|Search|Home|My Network|Jobs|Notifications)+/i,
                        ''
                    )
                );

                const fallbackLocationMatch = headerText.match(
                    /((?:Bengaluru|Bangalore|Mumbai|Delhi|Hyderabad|Pune|Chennai|Gurugram|Gurgaon|Noida|Ahmedabad|Kolkata),\s*[A-Z][A-Za-z .'-]+,\s*(?:India|Sweden|United States|USA|UK|Singapore))/i
                );

                const fallbackLocation =
                    clean(fallbackLocationMatch?.[1]);

                if (!location && fallbackLocation) {
                    location = fallbackLocation;
                }

                const afterLocation = clean(
                    fallbackLocation
                        ? headerText.split(fallbackLocation)[1] || ''
                        : ''
                );

                const beforeLocation = clean(
                    fallbackLocation
                        ? headerText.split(fallbackLocation)[0]
                        : headerText.split('Contact info')[0]
                );

                const titleStartMatch = beforeLocation.match(
                    /\b(Chief|Founder|Co-Founder|CEO|CTO|CFO|COO|Director|Manager|Engineer|Recruiter|Specialist|President|Lead|Officer|Consultant|Advisor|Head|Partner|Owner|Vice President|VP)\b/i
                );

                if (titleStartMatch) {
                    const fallbackName =
                        clean(beforeLocation.slice(0, titleStartMatch.index));

                    const roleAndCompany =
                        clean(beforeLocation.slice(titleStartMatch.index));

                    if (!name && fallbackName) {
                        name = fallbackName;
                    }

                    if (!company && headline && roleAndCompany.startsWith(headline)) {
                        company = clean(
                            roleAndCompany.slice(headline.length)
                        );
                    }

                    if (!headline || !company) {
                        const repeatedCompanyMatch = roleAndCompany.match(
                            /^(.+?\bat\s+(.+?))\s*\2(?=\s|·|[A-Z]|$)/i
                        );

                        if (repeatedCompanyMatch) {
                            if (!headline) {
                                headline = clean(repeatedCompanyMatch[1]);
                            }

                            if (!company) {
                                company = clean(
                                    roleAndCompany.slice(
                                        repeatedCompanyMatch[1].length
                                    )
                                );
                            }
                        } else if (!headline) {
                            headline = roleAndCompany;
                        }
                    }
                }

                if (!company && afterLocation) {
                    let afterLocationCompany =
                        afterLocation
                            .replace(/^[·\s]+/g, '')
                            .replace(/^Contact info\s*/i, '');

                    for (const separator of companySeparators) {
                        afterLocationCompany =
                            afterLocationCompany.split(separator)[0];
                    }

                    company = clean(afterLocationCompany);
                }
            }

            name = clean(
                name
                    .replace(/\b(She\/Her|He\/Him|They\/Them)\b/ig, '')
                    .replace(/\b(Talent Acquisition|HR Business|Human Resources)\b.*$/i, '')
            );

            return {
                name: clean(name),
                headline: clean(headline),
                company: clean(company),
                location: locationRegex.test(clean(location)) ? clean(location) : ''
            };
        });

        const result = {
            url,
            name: profile.name || '',
            headline: profile.headline || '',
            company: profile.company || '',
            location: profile.location || ''
        };

        setCachedEntry(url, result, cache);
        saveCache(cache, 'ranked-mutuals-cache');

        return result;

    } catch (err) {

        console.log('Failed:', url);
        console.log(err.message);

        if (isFatalError(err)) {
            throw err;
        }

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

    let urls = JSON.parse(
        fs.readFileSync(
            './data/mutuals.json',
            'utf8'
        )
    );

    const profileLimit = parsePositiveInteger(process.env.PROFILE_LIMIT, 0);
    const batchSize = parsePositiveInteger(process.env.BATCH_SIZE, 3);

    if (profileLimit > 0) {
        urls = urls.slice(0, profileLimit);
    }

    const { browser, page } =
        await startBrowser();

    const results = [];
    const cache = loadCache('ranked-mutuals-cache');
    const batches = batchArray(urls, batchSize);
    let consecutiveFailures = 0;
    let stopped = false;

    console.log('Processing ' + urls.length + ' mutuals in ' + batches.length + ' batch(es).');

    for (const batch of batches) {
        for (const url of batch) {

            console.log('Checking:', url);

            try {
                const profile =
                    await scrapeProfile(
                        page,
                        url,
                        cache
                    );

                profile.score =
                    scoreProfile(profile);

                results.push(profile);
                consecutiveFailures = 0;

                console.log({
                    name: profile.name,
                    headline: profile.headline,
                    company: profile.company,
                    location: profile.location,
                    score: profile.score
                });
            } catch (err) {
                consecutiveFailures += 1;
                console.error('Failed: ' + url);
                console.error(err.message);

                if (isFatalError(err) || consecutiveFailures >= 3) {
                    console.error('Stopping due to repeated failures or blocking.');
                    stopped = true;
                    break;
                }
            }

            await sleep(6000, 10000);
        }

        if (stopped) {
            break;
        }

        console.log('Batch complete. Pausing before next batch.');
        await sleep(10000, 15000);
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
            `"${(r.name || '').replace(/"/g, '')}",` +
            `"${(r.company || '').replace(/"/g, '')}",` +
            `"${(r.location || '').replace(/"/g, '')}",` +
            `${r.score},` +
            `"${r.url}"`
        );
    }

    fs.writeFileSync(
        './data/ranked-mutuals.csv',
        csv.join('\n')
    );

    console.log('');
    console.log('Saved: data/ranked-mutuals.csv');

    await browser.close();

})();
