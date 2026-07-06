const fs = require("fs/promises");
const path = require("path");

const TARGET_PATH = path.resolve(__dirname, "..", "data", "target.json");
const OUTPUT_PATH = path.resolve(__dirname, "..", "data", "mutuals.json");



const SELECTORS = {
    resultsContainer: "main",
    profileLinks: 'a[href*="/in/"]'
};

const TIMEOUTS = {
    pageLoadMs: 45000,
    resultsContainerMs: 20000,
    afterManualFilterMs: 3000
};

function formatDuration(startTime) {
    const elapsedMs = Date.now() - startTime;
    const seconds = (elapsedMs / 1000).toFixed(1);

    return seconds + "s";
}

function normalizeLinkedInProfileUrl(value) {
    if (!value) {
        return "";
    }

    try {
        const url = new URL(value);
        const hostname = url.hostname.replace(/^www\./, "");

        if (hostname !== "linkedin.com") {
            return "";
        }

        const profileMatch = url.pathname.match(/^\/in\/[^/]+\/?/i);

        if (!profileMatch) {
            return "";
        }

        return "https://www.linkedin.com" +
            profileMatch[0].replace(/\/?$/, "/");
    } catch (err) {
        return "";
    }
}

async function loadTarget() {
    let rawTarget;

    try {
        rawTarget = await fs.readFile(TARGET_PATH, "utf8");
    } catch (err) {
        throw new Error(
            "Unable to read data/target.json. Run index.js with a target first."
        );
    }

    let target;

    try {
        target = JSON.parse(rawTarget);
    } catch (err) {
        throw new Error("data/target.json is not valid JSON.");
    }

    const targetUrl = normalizeLinkedInProfileUrl(target.url);

    if (!target.name) {
        throw new Error(
            "data/target.json must include a target name."
        );
    }

    return {
        name: target.name,
        company: target.company || "",
        url: targetUrl
    };
}



async function collectProfiles(page) {

    await page.waitForTimeout(TIMEOUTS.afterManualFilterMs);

    const profiles = await page
        .locator(SELECTORS.profileLinks)
        .evaluateAll(links => {

            const results = [];

            for (const link of links) {

                results.push({
                    name: (link.textContent || "").trim(),
                    linkedin_url: link.href
                });
            }

            return results;
        });

    if (!profiles.length) {
        console.log("No visible LinkedIn profiles found.");
    }

    return profiles;
}

async function scrollToBottom(page) {

let previousCount = 0;
let stableRounds = 0;
    while (true) {

        // Scroll down slowly
const distance =
    250 + Math.floor(Math.random() * 350);
const viewport = page.viewportSize();

if (viewport) {

    await page.mouse.move(
        200 + Math.random() * (viewport.width - 400),
        150 + Math.random() * (viewport.height - 250),
        {
            steps: 10 + Math.floor(Math.random() * 15)
        }
    );
}
await page.mouse.wheel(0, distance);
const pause =
    800 + Math.floor(Math.random() * 1000);

await page.waitForTimeout(pause);
        const currentCount = await page
            .locator(SELECTORS.profileLinks)
            .count();

        console.log("Profiles loaded:", currentCount);

      if (currentCount === previousCount) {

    stableRounds++;

    if (stableRounds >= 3) {
        break;
    }

} else {

    stableRounds = 0;
}

previousCount = currentCount;
    }

    console.log("Finished scrolling.");
}

async function goToNextPage(page) {

    const nextButton = page.locator(
        'button[data-testid="pagination-controls-next-button-visible"]'
    );

    if (!(await nextButton.isVisible().catch(() => false))) {
        return false;
    }

    if (await nextButton.isDisabled()) {
        return false;
    }

    // Scroll the button into view
    await nextButton.scrollIntoViewIfNeeded();

    // Extra wheel to move the cards away
    await page.mouse.wheel(0, 800);

    await page.waitForTimeout(1000);

    console.log("Moving to next page...");

    await nextButton.click({
        force: true
    });

    await page.waitForLoadState("domcontentloaded");

    await page.waitForTimeout(3000);

    console.log("Next page opened.");

    return true;
}

function normalizeUrls(urls, targetUrl) {
    const normalizedTargetUrl = normalizeLinkedInProfileUrl(targetUrl);
    const uniqueUrls = new Set();

    for (const url of urls) {
        const normalizedUrl = normalizeLinkedInProfileUrl(url);

        if (
            normalizedUrl &&
            (!normalizedTargetUrl || normalizedUrl !== normalizedTargetUrl)
        ) {
            uniqueUrls.add(normalizedUrl);
        }
    }

    return [...uniqueUrls];
}
function normalizeProfiles(
    profiles,
    targetUrl,
    targetName
) {
    const normalizedTargetUrl =
        normalizeLinkedInProfileUrl(targetUrl);

    const uniqueProfiles = new Map();

    for (const profile of profiles) {

       const normalizedUrl =
normalizeLinkedInProfileUrl(
profile.linkedin_url
    );
        if (!normalizedUrl) {
            continue;
        }

        if (
            normalizedTargetUrl &&
            normalizedUrl === normalizedTargetUrl
        ) {
            continue;
        }
if (
    targetName &&
    (profile.name || "")
        .toLowerCase()
        .includes(targetName.toLowerCase())
) {
    continue;
}
        uniqueProfiles.set(normalizedUrl, {
            name: (profile.name || "").trim(),
            linkedin_url: normalizedUrl
        });
    }

    return [...uniqueProfiles.values()];
}

async function saveResults(profileUrls) {
    await fs.writeFile(
        OUTPUT_PATH,
        JSON.stringify(profileUrls, null, 2) + "\n"
    );
}

async function browseFeedNaturally(page) {

    console.log("");
    console.log("Returning to LinkedIn feed...");

    await page.goto(
        "https://www.linkedin.com/feed/",
        {
            waitUntil: "domcontentloaded"
        }
    );

    await page.waitForTimeout(5000);

    console.log("Feed opened.");
}

function logTarget(target) {
    console.log("");
    console.log("Collecting LinkedIn mutual connections");
    console.log("======================================");
    console.log("Target :", target.name);
    console.log("Company:", target.company || "Not provided");
    console.log("URL    :", target.url || "Not provided");
    console.log("======================================");
    console.log("");
}

async function collectMutuals(page) {
        const startedAt = Date.now();

    try {
        const target = await loadTarget();

        logTarget(target);

       

let collectedProfiles = [];
while (true) {

console.log("==============================");
console.log("Processing current page...");
console.log("==============================");
    await scrollToBottom(page);

const profiles = await collectProfiles(page);

collectedProfiles.push(...profiles);

console.log("");
console.log("First profile collected:");
console.log(profiles[0]);
console.log("");



    const hasNext = await goToNextPage(page);

    if (!hasNext) {
        break;
    }
}

const profiles = normalizeProfiles(
    collectedProfiles,
    target.url,
    target.name
);
await saveResults(profiles);

await browseFeedNaturally(page);

console.log("");
console.log("Profiles collected:", profiles.length);
console.log("Saved: data/mutuals.json");
console.log("Time taken:", formatDuration(startedAt));
console.log("");
    } catch (err) {
        console.error("");
        console.error("Collect mutuals failed");
        console.error("======================");
        console.error(err.message);
        console.error("Time taken:", formatDuration(startedAt));
throw err;    } 
}

module.exports = collectMutuals;