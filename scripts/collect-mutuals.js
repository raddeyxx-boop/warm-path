const fs = require("fs/promises");
const path = require("path");
const {
    writeJsonAtomic
} = require("../utils/JsonFileStore");

const DATA_DIR = path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(__dirname, "..", "data"));
const TARGET_PATH = path.join(DATA_DIR, "target.json");
const OUTPUT_PATH = path.join(DATA_DIR, "mutuals.json");



const SELECTORS = {
    resultsContainer: "main",
    profileLinks: 'main a[href*="/in/"]'
};

const TIMEOUTS = {
    pageLoadMs: 45000,
    resultsContainerMs: 20000,
    afterManualFilterMs: 3000,
    profileProbeMs: 1200,
    nextPageMs: 12000
};

const LIMITS = {
    maxPages: 30,
    maxScrollRounds: 18,
    stableScrollRounds: 3
};

function formatDuration(startTime) {
    const elapsedMs = Date.now() - startTime;
    const seconds = (elapsedMs / 1000).toFixed(1);

    return seconds + "s";
}

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function pause(page, minMs, maxMs) {
    await page.waitForTimeout(randomInt(minMs, maxMs)).catch(() => {});
}

async function moveMouseNaturally(page) {
    const viewport = page.viewportSize();

    if (!viewport) {
        return;
    }

    const startX = randomInt(100, Math.max(140, viewport.width - 160));
    const startY = randomInt(110, Math.max(150, viewport.height - 170));
    const endX = randomInt(120, Math.max(160, viewport.width - 190));
    const endY = randomInt(130, Math.max(170, viewport.height - 190));
    const midX = Math.round((startX + endX) / 2 + randomInt(-120, 120));
    const midY = Math.round((startY + endY) / 2 + randomInt(-80, 80));

    await page.mouse.move(startX, startY, {
        steps: randomInt(5, 12)
    }).catch(() => {});
    await page.mouse.move(midX, midY, {
        steps: randomInt(8, 18)
    }).catch(() => {});
    await page.mouse.move(endX, endY, {
        steps: randomInt(8, 20)
    }).catch(() => {});
}

function mutualScrollDistance() {
    const ranges = [
        [120, 260],
        [260, 460],
        [460, 720]
    ];
    const selected = ranges[randomInt(0, ranges.length - 1)];

    return randomInt(selected[0], selected[1]);
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

    await page.locator(SELECTORS.resultsContainer).first().waitFor({
        state: "visible",
        timeout: TIMEOUTS.resultsContainerMs
    });

    const profiles = await page
        .locator(SELECTORS.profileLinks)
        .evaluateAll(links => {

            const results = [];

            const clean = value => (value || "").replace(/\s+/g, " ").trim();

            for (const link of links) {
                const imageAlt = clean(link.querySelector("img[alt]")?.getAttribute("alt"));
                const ariaLabel = clean(link.getAttribute("aria-label"));
                const visibleText = clean(link.innerText || link.textContent);
                const name = visibleText || imageAlt || ariaLabel;

                results.push({
                    name,
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
    for (let round = 1; round <= LIMITS.maxScrollRounds; round++) {

        const distance = mutualScrollDistance();

        await moveMouseNaturally(page);
        await page.mouse.wheel(0, distance);
        await pause(page, 1200, 2800);

        if (Math.random() < 0.16) {
            console.log("Reading mutual result cards...");
            await pause(page, 3000, 7000);
        }

        if (Math.random() < 0.18) {
            await page.mouse.wheel(0, -randomInt(60, 180)).catch(() => {});
            await pause(page, 900, 1800);
        }
        const currentCount = await page
            .locator(SELECTORS.profileLinks)
            .count()
            .catch(() => 0);

        console.log("Profiles loaded:", currentCount);

      if (currentCount === previousCount) {

    stableRounds++;

    if (stableRounds >= LIMITS.stableScrollRounds) {
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
    const previousUrl = page.url();
    const previousSignature = await getPageSignature(page);

    const nextButton = page.locator(
        'button[data-testid="pagination-controls-next-button-visible"], button[aria-label*="Next" i]'
    ).first();

    if (!(await nextButton.isVisible({ timeout: 2500 }).catch(() => false))) {
        return false;
    }

    if (await nextButton.isDisabled().catch(() => true)) {
        return false;
    }

    await nextButton.scrollIntoViewIfNeeded({
        timeout: 3000
    }).catch(() => {});

    await moveMouseNaturally(page);
    await pause(page, 900, 1900);
    await page.mouse.wheel(0, randomInt(120, 260));
    await pause(page, 900, 1800);
    await nextButton.hover({
        timeout: 2000
    }).catch(() => {});

    await pause(page, 700, 1600);

    console.log("Moving to next page...");

    await nextButton.click({
        delay: randomInt(90, 200),
        timeout: 5000
    });

    await page.waitForFunction(({ selector, previousUrlValue, previousSignatureValue }) => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const firstProfile = [...document.querySelectorAll(selector)]
            .map(link => clean(link.href) + "|" + clean(link.innerText || link.textContent))
            .find(Boolean) || "";

        return window.location.href !== previousUrlValue ||
            (firstProfile && firstProfile !== previousSignatureValue);
    }, {
        selector: SELECTORS.profileLinks,
        previousUrlValue: previousUrl,
        previousSignatureValue: previousSignature
    }, {
        timeout: TIMEOUTS.nextPageMs
    });

    console.log("Next page opened.");
    await pause(page, 1800, 3600);

    return true;
}

async function getPageSignature(page) {
    return await page.locator(SELECTORS.profileLinks).evaluateAll(links => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const firstProfile = links
            .map(link => clean(link.href) + "|" + clean(link.innerText || link.textContent))
            .find(Boolean);

        return firstProfile || "";
    }).catch(() => "");
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
        const existing = uniqueProfiles.get(normalizedUrl);
        const nextName = (profile.name || "").trim();
        const existingName = existing?.name || "";

        uniqueProfiles.set(normalizedUrl, {
            ...existing,
            ...profile,
            name: nextName.length >= existingName.length ? nextName : existingName,
            linkedin_url: normalizedUrl
        });
    }

    return [...uniqueProfiles.values()];
}

async function saveResults(profileUrls) {
    await writeJsonAtomic(OUTPUT_PATH, profileUrls);
}

async function browseFeedNaturally(page) {

    console.log("");
    console.log("Pausing naturally before closing collection session...");
    await page.waitForTimeout(1500 + Math.floor(Math.random() * 2500));
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
        let collectedProfiles = [];
        let target = null;
        let reachedPageCap = true;

    try {
        target = await loadTarget();

        logTarget(target);

       

for (let pageIndex = 1; pageIndex <= LIMITS.maxPages; pageIndex++) {

console.log("==============================");
console.log("Processing current page:", pageIndex);
console.log("==============================");
    await scrollToBottom(page);

const profiles = await collectProfiles(page);

collectedProfiles.push(...profiles);

console.log("");
console.log("First profile collected:");
console.log(profiles[0] || null);
console.log("");

const normalizedPartial = normalizeProfiles(
    collectedProfiles,
    target.url,
    target.name
);

await saveResults(normalizedPartial);
console.log("Partial mutuals saved:", normalizedPartial.length);


    const hasNext = await goToNextPage(page);

    if (!hasNext) {
        reachedPageCap = false;
        break;
    }
}

if (reachedPageCap) {
    console.log("Reached mutual collection page cap:", LIMITS.maxPages);
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
        console.error("File: scripts/collect-mutuals.js");
        console.error("Function: collectMutuals");
        console.error("Reason:", err.message);
        console.error("Recovery: saving partial mutuals before propagating failure.");
        console.error("Time taken:", formatDuration(startedAt));
        if (target && collectedProfiles.length) {
            const partialProfiles = normalizeProfiles(
                collectedProfiles,
                target.url,
                target.name
            );

            await saveResults(partialProfiles).catch(saveErr => {
                console.error("Partial mutual save failed:", saveErr.message);
            });
            console.error("Partial mutuals saved:", partialProfiles.length);
        }
throw err;    } 
}

module.exports = collectMutuals;
module.exports.normalizeLinkedInProfileUrl = normalizeLinkedInProfileUrl;
module.exports.normalizeProfiles = normalizeProfiles;
