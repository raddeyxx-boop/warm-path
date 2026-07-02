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



async function collectProfileUrls(page) {
    await page.waitForTimeout(TIMEOUTS.afterManualFilterMs);

    const urls = await page
        .locator(SELECTORS.profileLinks)
        .evaluateAll(links => links.map(link => link.href));

    if (!urls.length) {
        console.log("No visible LinkedIn profile links found on the page.");
    }

    return urls;
}
async function scrollToBottom(page) {

let previousCount = 0;
let stableRounds = 0;
    while (true) {

        // Scroll down slowly
const distance =
    250 + Math.floor(Math.random() * 350);

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

    const disabled = await nextButton.getAttribute("disabled");

    if (disabled !== null) {
        return false;
    }

    await page.waitForTimeout(
        1000 + Math.floor(Math.random() * 1500)
    );

    await nextButton.scrollIntoViewIfNeeded();

  await nextButton.click();

console.log("Moving to next page...");

await page.waitForTimeout(
    3000 + Math.floor(Math.random() * 1500)
);

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

async function saveResults(profileUrls) {
    await fs.writeFile(
        OUTPUT_PATH,
        JSON.stringify(profileUrls, null, 2) + "\n"
    );
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

       

 let collectedUrls = [];

while (true) {

console.log("==============================");
console.log("Processing current page...");
console.log("==============================");
    await scrollToBottom(page);

    collectedUrls.push(
        ...(await collectProfileUrls(page))
    );

    const hasNext = await goToNextPage(page);

    if (!hasNext) {
        break;
    }
}

const profileUrls = normalizeUrls(
    collectedUrls,
    target.url
);
        await saveResults(profileUrls);

        console.log("");
        console.log("Profiles collected:", profileUrls.length);
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