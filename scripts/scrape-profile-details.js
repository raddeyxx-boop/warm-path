const fs = require("fs/promises");
const path = require("path");
const startBrowser = require("../services/browser");

const MUTUALS_PATH = path.resolve(__dirname, "..", "data", "mutuals.json");
const OUTPUT_PATH = path.resolve(__dirname, "..", "data", "mutual-details.json");
const TARGET_PATH = path.resolve(__dirname, "..", "data", "target.json");
const TIMEOUTS = {
    profileMs: 60000,
    pageLoadMs: 45000,
    contentMs: 15000,
    afterLoadMs: 2500
};

const SELECTORS = {
    main: "main",
    name: "h1",
    headline: [
        ".pv-text-details__left-panel div.text-body-medium",
        ".text-body-medium.break-words",
        ".text-body-medium"
    ],
    location: [
        ".pv-text-details__left-panel span.text-body-small.inline",
        ".pv-text-details__left-panel span.text-body-small",
        ".text-body-small.inline"
    ],
    companyHeader: [
        ".pv-text-details__right-panel a[href*='/company/']",
        ".pv-text-details__right-panel button",
        ".pv-text-details__right-panel li"
    ]
};

function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
}

function toLines(value) {
    return (value || "")
        .split("\n")
        .map(line => cleanText(line))
        .filter(Boolean);
}

function isLinkedInProfileUrl(value) {
    try {
        const url = new URL(value);
        const hostname = url.hostname.replace(/^www\./, "");

        return hostname === "linkedin.com" &&
            /^\/in\/[^/]+\/?/i.test(url.pathname);
    } catch (err) {
        return false;
    }
}

function normalizeProfileUrl(value) {
    if (!isLinkedInProfileUrl(value)) {
        return "";
    }

    const url = new URL(value);
    const profilePath = url.pathname.match(/^\/in\/[^/]+\/?/i)[0];

    return "https://www.linkedin.com" +
        profilePath.replace(/\/?$/, "/");
}

function formatDuration(startTime) {
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    if (minutes > 0) {
        return minutes + "m " + seconds + "s";
    }

    return seconds + "s";
}

async function readJsonFile(filePath, missingMessage) {
    let rawJson;

    try {
        rawJson = await fs.readFile(filePath, "utf8");
    } catch (err) {
        if (err.code === "ENOENT") {
            throw new Error(missingMessage);
        }

        throw err;
    }

    try {
        return JSON.parse(rawJson);
    } catch (err) {
        throw new Error(
            path.relative(process.cwd(), filePath) + " is not valid JSON."
        );
    }
}

async function getFirstLocatorText(page, selectors) {
    for (const selector of selectors) {
        try {
            const locator = page.locator(selector).first();

            if (await locator.count()) {
                const text = cleanText(await locator.textContent({
                    timeout: 3000
                }));

                if (text) {
                    return text;
                }
            }
        } catch (err) {}
    }

    return "";
}

function getLineAfter(lines, label) {
    const index = lines.findIndex(
        line => line.toLowerCase() === label.toLowerCase()
    );

    if (index >= 0 && lines[index + 1]) {
        return lines[index + 1];
    }

    return "";
}

function extractCompanyFromHeadline(headline) {
    const patterns = [
        /\bat\s+(.+)$/i,
        /\b@\s*(.+)$/i
    ];

    for (const pattern of patterns) {
        const match = headline.match(pattern);

        if (match && match[1]) {
            return cleanText(match[1]);
        }
    }

    return "";
}

function looksLikeLocation(value) {
    return (
        /\bgreater\s+.+\s+area\b/i.test(value) ||
        /^[A-Za-z .'-]+,\s*[A-Za-z .'-]+(,\s*[A-Za-z .'-]+)?$/.test(value) ||
        /\b(india|sweden|usa|united states|united kingdom|canada|germany)\b/i.test(value)
    );
}

async function extractName(page, lines) {
    try {
        const name = cleanText(
            await page.locator(SELECTORS.name).first().textContent({
                timeout: 5000
            })
        );

        if (name) {
            return name;
        }
    } catch (err) {}

    return lines[0] || "";
}

async function extractHeadline(page, lines, name) {
    const headline = await getFirstLocatorText(page, SELECTORS.headline);

    if (headline) {
        return headline;
    }

    const nameIndex = lines.findIndex(line => name && line.includes(name));

    if (nameIndex >= 0 && lines[nameIndex + 1]) {
        return lines[nameIndex + 1];
    }

    return "";
}

async function extractCompany(page, lines, headline) {
    const companyFromHeadline = extractCompanyFromHeadline(headline);

    if (companyFromHeadline) {
        return companyFromHeadline;
    }

    const headerCompany = await getFirstLocatorText(
        page,
        SELECTORS.companyHeader
    );

    if (headerCompany) {
        return headerCompany;
    }
async function extractCollege(page, lines) {

    const education = getLineAfter(lines, "Education");

    if (education) {
        return education;
    }

    return "";
}
    try {
        const experienceSection = page
            .locator("section")
            .filter({
                has: page.locator("#experience")
            })
            .first();

        if (await experienceSection.count()) {
            const experienceLines = toLines(
                await experienceSection.textContent({
                    timeout: 5000
                })
            );

            const companyLine = experienceLines.find(line =>
                / · /.test(line) ||
                /\b(full-time|part-time|self-employed|contract|freelance)\b/i.test(line)
            );

            if (companyLine) {
                return cleanText(companyLine.split(" · ")[0]);
            }
        }
    } catch (err) {}

    const experienceFallback = getLineAfter(lines, "Experience");

    if (experienceFallback) {
        return experienceFallback;
    }

    return "";
}

async function extractLocation(page, lines) {
    const location = await getFirstLocatorText(page, SELECTORS.location);

    if (location && looksLikeLocation(location)) {
        return location;
    }

    return lines.find(looksLikeLocation) || location || "";
}

async function extractAbout(page, lines) {
    try {
        const aboutSection = page
            .locator("section")
            .filter({
                has: page.locator("#about")
            })
            .first();

        if (await aboutSection.count()) {
            const aboutLines = toLines(
                await aboutSection.textContent({
                    timeout: 5000
                })
            ).filter(line => !/^about$/i.test(line));

            const about = cleanText(aboutLines.join(" "));

            if (about) {
                return about;
            }
        }
    } catch (err) {}

    const aboutIndex = lines.findIndex(line => /^about$/i.test(line));

    if (aboutIndex < 0) {
        return "";
    }

    const stopLabels = new Set([
        "activity",
        "experience",
        "education",
        "skills",
        "licenses & certifications",
        "recommendations",
        "interests"
    ]);

    const aboutLines = [];

    for (const line of lines.slice(aboutIndex + 1)) {
        if (stopLabels.has(line.toLowerCase())) {
            break;
        }

        aboutLines.push(line);
    }

    return cleanText(aboutLines.join(" "));
}

async function extractConnectionStatus(page) {
    const statusChecks = [
        {
            label: "Connected",
            locator: page.getByRole("button", {
                name: /^message$/i
            })
        },
        {
            label: "Message Available",
            locator: page.getByRole("link", {
                name: /^message$/i
            })
        },
        {
            label: "Connect Available",
            locator: page.getByRole("button", {
                name: /^connect$/i
            })
        },
        {
            label: "Follow Only",
            locator: page.getByRole("button", {
                name: /^follow$/i
            })
        }
    ];

    for (const check of statusChecks) {
        try {
            if (await check.locator.count()) {
                return check.label;
            }
        } catch (err) {}
    }

    return "Unknown";
}

async function loadMutuals() {
    const mutuals = await readJsonFile(
        MUTUALS_PATH,
        "data/mutuals.json was not found. Run scripts/collect-mutuals.js first."
    );

    if (!Array.isArray(mutuals)) {
        throw new Error("data/mutuals.json must contain an array of profile URLs.");
    }

    const profileUrls = [...new Set(mutuals
        .map(normalizeProfileUrl)
        .filter(Boolean))];

    if (!profileUrls.length) {
        throw new Error("data/mutuals.json does not contain any valid LinkedIn profile URLs.");
    }

    return profileUrls;
}

async function loadExistingResults() {
    try {
        const existingResults = await readJsonFile(
            OUTPUT_PATH,
            "data/mutual-details.json does not exist yet."
        );

        if (!Array.isArray(existingResults)) {
            console.log("Ignoring existing data/mutual-details.json because it is not an array.");
            return [];
        }

        return existingResults.filter(result =>
            result &&
            normalizeProfileUrl(result.linkedin_url)
        );
    } catch (err) {
        if (err.message.includes("does not exist yet")) {
            return [];
        }

        console.log("Ignoring existing data/mutual-details.json:", err.message);
        return [];
    }
}

async function saveResults(results) {
    await fs.writeFile(
        OUTPUT_PATH,
        JSON.stringify(results, null, 2) + "\n",
        "utf8"
    );
}

async function getMainLines(page) {
    try {
        await page.waitForSelector(SELECTORS.main, {
            timeout: TIMEOUTS.contentMs
        });

        return toLines(await page.locator(SELECTORS.main).textContent({
            timeout: 5000
        }));
    } catch (err) {
        return [];
    }
}

async function scrapeProfile(page, profileUrl) {
    page.setDefaultTimeout(TIMEOUTS.profileMs);
    page.setDefaultNavigationTimeout(TIMEOUTS.pageLoadMs);

    await page.goto(profileUrl, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUTS.pageLoadMs
    });

    await page.waitForLoadState("networkidle", {
        timeout: TIMEOUTS.contentMs
    }).catch(() => {});

    await page.waitForTimeout(TIMEOUTS.afterLoadMs);

    const currentUrl = page.url();

    if (
        currentUrl.includes("/login") ||
        currentUrl.includes("/checkpoint") ||
        currentUrl.includes("/404")
    ) {
        throw new Error("Profile unavailable or LinkedIn session needs attention.");
    }

    const lines = await getMainLines(page);
    const name = await extractName(page, lines);
    const headline = await extractHeadline(page, lines, name);
    const company = await extractCompany(page, lines, headline);
    const college = await extractCollege(page, lines);
    const location = await extractLocation(page, lines);
    const about = await extractAbout(page, lines);
    const connectionStatus = await extractConnectionStatus(page);

   return {
    linkedin_url: profileUrl,
    name,
    headline,
    company,
    college,
    location,
    about,
    connection_status: connectionStatus
};
}

function logProgress(index, total, profileUrl) {
    console.log("");
    console.log("--------------------------------");
    console.log("[" + index + " / " + total + "]");
    console.log("Opening:");
    console.log(profileUrl);
    console.log("--------------------------------");
}

function logExtractedProfile(profile) {
    console.log((profile.name ? "✓" : "-") + " Name");
    console.log((profile.company ? "✓" : "-") + " Company");
    console.log((profile.location ? "✓" : "-") + " Location");
}

function logSummary(startedAt, scrapedCount, failedCount) {
    console.log("");
    console.log("Completed");
    console.log("");
    console.log("Profiles scraped:");
    console.log(scrapedCount);
    console.log("");
    console.log("Failed:");
    console.log(failedCount);
    console.log("");
    console.log("Time:");
    console.log(formatDuration(startedAt));
}

async function main() {
    const startedAt = Date.now();
   let browser;
let session;
let results = [];
let failedCount = 0;
let scrapedCount = 0;
    try {
        const profileUrls = await loadMutuals();
        const target = await readJsonFile(
    TARGET_PATH,
    "data/target.json not found."
);
results = await loadExistingResults();
        const scrapedUrls = new Set(
            results.map(result => normalizeProfileUrl(result.linkedin_url))
        );

        console.log("");
        console.log("Scraping LinkedIn profile details");
        console.log("=================================");
        console.log("Profiles:", profileUrls.length);
        console.log("Already scraped:", scrapedUrls.size);

        await saveResults(results);

        const session = await startBrowser();
        browser = session.browser;
process.on("SIGINT", async () => {

    console.log("\nSaving progress...");

    await saveResults(results);

    if (browser) {
        await browser.close().catch(() => {});
    }

    console.log("Progress saved.");
    process.exit(0);
});


        for (const [index, profileUrl] of profileUrls.entries()) {
            const normalizedUrl = normalizeProfileUrl(profileUrl);

            if (scrapedUrls.has(normalizedUrl)) {
                console.log("");
                console.log("[" + (index + 1) + " / " + profileUrls.length + "] Skipping already scraped profile");
                console.log(profileUrl);
                continue;
            }

            logProgress(index + 1, profileUrls.length, profileUrl);

            try {
                const profile = await scrapeProfile(session.page, profileUrl);
  const sameCompany =
    profile.company &&
    target.company &&
    profile.company
        .toLowerCase()
        .includes(target.company.toLowerCase());

const sameCollege =
    profile.college &&
    target.college &&
    profile.college
        .toLowerCase()
        .includes(target.college.toLowerCase());

const matched = sameCompany || sameCollege;

if (!matched) {
    console.log("✗ No company or college match. Skipping...");
    continue;
}
results.push(profile);
                scrapedUrls.add(normalizedUrl);
                scrapedCount += 1;

                logExtractedProfile(profile);

                await saveResults(results);
                console.log("✓ Saved");
            } catch (err) {
                failedCount += 1;
                console.error("Profile failed:", err.message);

                await session.page.goto("about:blank", {
                    waitUntil: "domcontentloaded",
                    timeout: 10000
                }).catch(() => {});
            }
        }

        logSummary(startedAt, results.length, failedCount);
    } catch (err) {
        console.error("");
        console.error("Scrape profile details failed");
        console.error("=============================");
        console.error(err.message);
        console.error("Time taken:", formatDuration(startedAt));
        process.exitCode = 1;
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    extractName,
    extractHeadline,
    extractCompany,
    extractLocation,
    extractAbout,
    extractConnectionStatus,
    scrapeProfile,
    saveResults,
    loadMutuals,
    loadExistingResults,
    main
};
