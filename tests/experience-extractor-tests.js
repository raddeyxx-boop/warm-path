const assert = require("assert");
const { chromium } = require("playwright");
const { extractExperience } = require("../scripts/extractors/experience");

async function testExperienceDetailPageMerge() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.route("https://www.linkedin.com/in/sample/details/experience/", route => {
        route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: `
                <main>
                    <section>
                        <h1>Experience</h1>
                        <ul>
                            <li>
                                <div>Account Executive</div>
                                <div>Indpro &middot; Full-time</div>
                                <div>Mar 2019 - Present &middot; 7 yrs 5 mos</div>
                                <div>Bangalore</div>
                            </li>
                            <li>
                                <div>Accountant</div>
                                <div>Charted Accountant Consulting Firm &middot; Full-time</div>
                                <div>Aug 2016 - Feb 2019 &middot; 2 yrs 7 mos</div>
                            </li>
                        </ul>
                    </section>
                </main>
            `
        });
    });

    await page.setContent(`
        <main>
            <section>
                <h2>Experience</h2>
                <ul>
                    <li>
                        <div>Account Executive</div>
                        <div>Indpro &middot; Full-time</div>
                        <div>Mar 2019 - Present &middot; 7 yrs 5 mos</div>
                        <div>Bangalore</div>
                        <div>Personal Income Tax Returns, Tds and +3 skills</div>
                    </li>
                </ul>
                <a href="https://www.linkedin.com/in/sample/details/experience/">
                    Show all 2 experiences
                </a>
            </section>
        </main>
    `);

    const experience = await extractExperience(page, { includeDetails: true });

    await browser.close();

    assert.deepStrictEqual(experience, [
        {
            company: "Indpro",
            title: "Account Executive",
            duration: {
                start: "2019-03",
                end: null,
                currently_working: true
            }
        },
        {
            company: "Charted Accountant Consulting Firm",
            title: "Accountant",
            duration: {
                start: "2016-08",
                end: "2019-02",
                currently_working: false
            }
        }
    ]);
}

(async () => {
    await testExperienceDetailPageMerge();
    console.log("Experience extractor tests passed.");
})().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
