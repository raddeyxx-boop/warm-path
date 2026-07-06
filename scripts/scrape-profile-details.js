const fs = require("fs/promises");
const path = require("path");
const startBrowser = require("../services/browser");
const {
    extractHeader,
    extractName,
    extractHeadline,
    extractCompany,
    extractLocation
} = require("./extractors/header");
const {
    extractAbout
} = require("./extractors/about");
const {
    extractExperience: extractExperienceSection,
    hasExperienceSection
} = require("./extractors/experience");
const {
    extractEducation
} = require("./extractors/education");
const {
    extractSkills
} = require("./extractors/skills");
const LINKEDIN_HOME_URL = "https://www.linkedin.com/feed/";
const MUTUALS_PATH = path.resolve(__dirname, "..", "data", "mutuals.json");
const OUTPUT_PATH = path.resolve(__dirname, "..", "data", "mutual-details.json");
const TARGET_PATH = path.resolve(__dirname, "..", "data", "target.json");

const TIMEOUTS = {
    profileMs: 60000,
    pageLoadMs: 45000,
    contentMs: 15000,
    afterLoadMs: 2500,
    searchBoxMs: 15000,
    suggestionsMs: 12000,
    navigationMs: 20000
};

const SELECTORS = {
    main: "main",
    name: "h1",
    searchInput: 'input[placeholder*="Search"]',
    searchSuggestions: '[role="listbox"] a[href*="/in/"]',
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

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function pause(page, minMs, maxMs) {
    await page.waitForTimeout(randomInt(minMs, maxMs));
}

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
        const url = new URL(value, "https://www.linkedin.com");
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

    const url = new URL(value, "https://www.linkedin.com");
    const profilePath = url.pathname.match(/^\/in\/[^/]+\/?/i)[0];

    return "https://www.linkedin.com" +
        profilePath.replace(/\/?$/, "/");
}
function normalizeCompanyName(value) {

    return (value || "")
        .toLowerCase()
        .replace(/\bab\b/g, "")
        .replace(/\binc\b/g, "")
        .replace(/\bltd\b/g, "")
        .replace(/\bllc\b/g, "")
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
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

function isUnexpectedLinkedInUrl(url) {
    return (
        url.includes("/login") ||
        url.includes("/checkpoint") ||
        url.includes("/uas/login") ||
        url.includes("/404")
    );
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




async function extractCollege(page, lines) {
    const education = getLineAfter(lines, "Education");

    if (education) {
        return education;
    }

    return "";
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

    const mutualProfiles = mutuals
        .filter(profile =>
            profile &&
            profile.name &&
            normalizeProfileUrl(profile.linkedin_url)
        )
        .map(profile => ({
            name: profile.name.trim(),
            linkedin_url: normalizeProfileUrl(profile.linkedin_url)
        }));

    if (!mutualProfiles.length) {
        throw new Error(
            "data/mutuals.json does not contain any valid profiles."
        );
    }

    return mutualProfiles;
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

async function moveMouseToLocator(page, locator, label) {
    await locator.waitFor({
        state: "visible",
        timeout: TIMEOUTS.contentMs
    });

    const box = await locator.boundingBox();

    if (!box) {
        throw new Error(label + " position could not be determined.");
    }

    await page.mouse.move(
        box.x + box.width * (0.35 + Math.random() * 0.3),
        box.y + box.height * (0.35 + Math.random() * 0.3),
        {
            steps: randomInt(18, 42)
        }
    );

    await pause(page, 180, 650);
}

async function naturalClick(page, locator, label) {
    await moveMouseToLocator(page, locator, label);
    await pause(page, 180, 500);

    await locator.click({
        delay: randomInt(60, 180),
        timeout: TIMEOUTS.contentMs
    });
}

async function typeLikeHuman(page, text) {
    for (const char of text) {
        await page.keyboard.type(char, {
            delay: randomInt(60, 155)
        });

        if (Math.random() < 0.14) {
            await pause(page, 180, 520);
        }
    }
}

async function openLinkedInHome(page) {
    console.log("Opening LinkedIn Home...");

    await page.goto(LINKEDIN_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUTS.pageLoadMs
    });

    await page.waitForLoadState("networkidle", {
        timeout: 5000
    }).catch(() => {});

    if (isUnexpectedLinkedInUrl(page.url())) {
        throw new Error("LinkedIn redirected to a login, checkpoint, or unavailable page.");
    }

    await page.locator(SELECTORS.searchInput).first().waitFor({
        state: "visible",
        timeout: TIMEOUTS.searchBoxMs
    });

    await pause(page, 1200, 3200);
    console.log("LinkedIn Home ready.");
}

async function searchProfile(page, mutualProfile) {
    const searchBox = page.locator(SELECTORS.searchInput).first();

    if (!(await searchBox.isVisible({ timeout: 3000 }).catch(() => false))) {
        console.log("Search box not visible. Recovering via LinkedIn Home.");
        await openLinkedInHome(page);
    }

    await naturalClick(page, searchBox, "Search box");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await pause(page, 80, 220);
    await page.keyboard.press("Backspace");
    await pause(page, 260, 620);

    console.log("Typing:", mutualProfile.name);
    await typeLikeHuman(page, mutualProfile.name);

    const suggestions = page.locator(SELECTORS.searchSuggestions);

    await suggestions.first().waitFor({
        state: "visible",
        timeout: TIMEOUTS.suggestionsMs
    });

    await pause(page, 450, 1100);
    return suggestions;
}

async function openVerifiedProfile(page, suggestion, expectedUrl) {
    const href = await suggestion.getAttribute("href");
    const suggestionUrl = normalizeProfileUrl(href || "");

    if (suggestionUrl !== expectedUrl) {
        throw new Error("Search suggestion URL did not match the expected profile.");
    }

    console.log("Correct profile found.");

    await naturalClick(page, suggestion, "Suggestion");
    console.log("Profile clicked.");

    await page.waitForURL(url => {
        return normalizeProfileUrl(url.href) === expectedUrl ||
            isUnexpectedLinkedInUrl(url.href);
    }, {
        timeout: TIMEOUTS.navigationMs
    });

    await page.waitForLoadState("domcontentloaded", {
        timeout: TIMEOUTS.pageLoadMs
    });

    await page.waitForLoadState("networkidle", {
        timeout: 7000
    }).catch(() => {});

    if (isUnexpectedLinkedInUrl(page.url())) {
        throw new Error("LinkedIn redirected unexpectedly after opening the profile.");
    }

    const openedUrl = normalizeProfileUrl(page.url());

    if (openedUrl !== expectedUrl) {
        throw new Error(
            "Opened profile URL mismatch. Expected " +
            expectedUrl +
            " but opened " +
            (openedUrl || page.url())
        );
    }

    await page.locator(SELECTORS.main).first().waitFor({
        state: "visible",
        timeout: TIMEOUTS.contentMs
    });

    await pause(page, 1000, 2600);
    console.log("Profile loaded.");
}

async function getProfileRenderState(page) {
    return page.evaluate(() => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const main = document.querySelector("main");

if (!main) {
   return {
    scrollY: window.scrollY,

    documentHeight: document.documentElement.scrollHeight,

    bodyHeight: document.body.scrollHeight,

    mainHeight: main.scrollHeight,

    mainClientHeight: main.clientHeight,

    viewportHeight: window.innerHeight,

    atBottom:
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 120
};
}

const headings = [
    ...main.querySelectorAll(`
        section h1,
        section h2,
        section h3,
        section [role="heading"],
        div[aria-level],
        span[role="heading"]
    `)
];
        const headingTexts = headings.map(heading => clean(heading.innerText));
        const hasSection = pattern => headingTexts.some(text => pattern.test(text));
     const footers = [...document.querySelectorAll("footer")];

const footerVisible = footers.some(footer => {
    const box = footer.getBoundingClientRect();

    return (
        box.top < window.innerHeight &&
        box.bottom > 0 &&
        box.height > 100
    );
});
        const interestsHeading = headings.find(heading =>
            /^Interests\b/i.test(clean(heading.innerText))
        );
        const interestsSection = interestsHeading?.closest("section");
        const interestsText = clean(interestsSection?.innerText || "");
        const interestsReached = !!interestsHeading &&
            /(Companies|Groups|Newsletters|Schools)/i.test(interestsText);

        return {
            scrollY: window.scrollY,
            scrollHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
            atBottom: window.scrollY + window.innerHeight >=
                document.documentElement.scrollHeight - 120,
            footerVisible,
            interestsReached,
            hasAbout: hasSection(/^About$/i),
            hasExperience: hasSection(/^Experience$/i),
            hasEducation: hasSection(/^Education$/i),
            hasSkills: hasSection(/^Skills(?:\s+\(\d+\))?$/i)
        };
    }).catch(() => ({
        scrollY: 0,
        scrollHeight: 0,
        viewportHeight: 0,
        atBottom: false,
        footerVisible: false,
        interestsReached: false,
        hasAbout: false,
        hasExperience: false,
        hasEducation: false,
        hasSkills: false
    }));
}

// LinkedIn profile pages are React-rendered and inject lower sections lazily.
// This function reports whether the DOM has reached the real profile end, not
// just whether the browser is near the current scrollHeight.
async function humanReadProfile(page) {
    console.log("Reading profile...");

    const minimumReadMs = 8000;
    const maximumReadMs = 20000;
    const started = Date.now();
    let downwardScrolls = 0;
    let stableEndCount = 0;
    let previousHeight = 0;
    const seen = {
    about: false,
    experience: false,
    education: false,
    skills: false,
    interests: false
};

    function elapsedReadMs() {
        return Date.now() - started;
    }

    function remainingReadMs() {
        return Math.max(0, maximumReadMs - elapsedReadMs());
    }

    async function pauseWithinReadBudget(minMs, maxMs) {
        const remaining = remainingReadMs();

        if (remaining <= 0) {
            return;
        }

        await page.waitForTimeout(Math.min(randomInt(minMs, maxMs), remaining));
    }

    await pauseWithinReadBudget(300, 500);

while (true) {
            const viewport = page.viewportSize();

        if (viewport) {
            await page.mouse.move(
                randomInt(120, Math.max(160, viewport.width - 160)),
                randomInt(110, Math.max(150, viewport.height - 150)),
                {
                    steps: randomInt(14, 34)
                }
            );
        }

        const shouldScrollUp =
            downwardScrolls >= 2 &&
            Math.random() < 0.12 &&
            remainingReadMs() > 2600;
      const distance = shouldScrollUp
    ? -randomInt(60, 180)
    : randomInt(320, 520);

       await page.mouse.wheel(0, distance);

if (distance > 0) {
    downwardScrolls += 1;
}

// Give React time to mount lazy-loaded sections.
const beforeHeight = await page.evaluate(
    () => document.documentElement.scrollHeight
);

await page.mouse.wheel(0, distance);

if (distance > 0) {
    downwardScrolls += 1;
}

await page.waitForFunction(
    height => document.documentElement.scrollHeight > height,
    beforeHeight,
    { timeout: 1500 }
).catch(() => {});

await pauseWithinReadBudget(450, 700);

await pauseWithinReadBudget(450, 700);

        if (shouldScrollUp) {
            await pauseWithinReadBudget(250, 420);
        }

        let state = await getProfileRenderState(page);
        seen.about ||= state.hasAbout;
seen.experience ||= state.hasExperience;
seen.education ||= state.hasEducation;
seen.skills ||= state.hasSkills;
seen.interests ||= state.interestsReached;
        console.log({
    scrollY: state.scrollY,
    scrollHeight: state.scrollHeight,
    atBottom: state.atBottom,
    footerVisible: state.footerVisible,
    interestsReached: state.interestsReached,
    hasAbout: state.hasAbout,
    hasExperience: state.hasExperience,
    hasEducation: state.hasEducation,
    hasSkills: state.hasSkills
});

        if (state.interestsReached && state.footerVisible && state.atBottom) {
            await page.mouse.wheel(0, randomInt(80, 180));
            await pauseWithinReadBudget(300, 600);
            state = await getProfileRenderState(page);
        }

        const heightStable = previousHeight > 0 &&
            Math.abs(state.scrollHeight - previousHeight) < 80;
   const sectionsLoaded =
    seen.about &&
    seen.experience &&
    seen.education &&
    seen.skills;

const trueEndReached =
    sectionsLoaded &&
    state.interestsReached &&
    state.footerVisible &&
    state.atBottom &&
    heightStable;
        previousHeight = state.scrollHeight;
        stableEndCount = trueEndReached ? stableEndCount + 1 : 0;

        if (Math.random() < 0.08 && remainingReadMs() > 1600) {
            await pauseWithinReadBudget(350, 600);
        }

      const profileFullyLoaded =
    seen.about &&
    seen.experience &&
    seen.education &&
    seen.skills &&
    seen.interests &&
    state.footerVisible;

if (
    elapsedReadMs() >= minimumReadMs &&
    profileFullyLoaded &&
    stableEndCount >= 3
) {
    console.log("Profile fully loaded.");
    break;
}
// Safety timeout only
// Safety timeout only
if (elapsedReadMs() >= maximumReadMs) {
    console.log("Safety timeout reached.");
    break;
}
    }

    console.log("Finished reading profile.");
}

// Keep extraction separate from rendering: after the human read, continue only
// when the real end is still not proven. This prevents writing false empty
// Experience/Education/Skills arrays while avoiding changes to navigation.
async function finishProfileRendering(page) {
    let stableEndCount = 0;
    let previousHeight = 0;
    const seen = {
    about: false,
    experience: false,
    education: false,
    skills: false,
    interests: false
};
    const started = Date.now();
    const maxRenderMs = 10000;

    while (Date.now() - started < maxRenderMs) {
        let state = await getProfileRenderState(page);
        seen.about ||= state.hasAbout;
seen.experience ||= state.hasExperience;
seen.education ||= state.hasEducation;
seen.skills ||= state.hasSkills;
seen.interests ||= state.interestsReached;
        console.log({
    scrollY: state.scrollY,
    scrollHeight: state.scrollHeight,
    atBottom: state.atBottom,
    footerVisible: state.footerVisible,
    interestsReached: state.interestsReached,
    hasAbout: state.hasAbout,
    hasExperience: state.hasExperience,
    hasEducation: state.hasEducation,
    hasSkills: state.hasSkills
});
        const heightStable = previousHeight > 0 &&
            Math.abs(state.scrollHeight - previousHeight) < 80;

        if (state.interestsReached && state.footerVisible && state.atBottom && heightStable) {
            stableEndCount += 1;
        } else {
            stableEndCount = 0;
        }

        previousHeight = state.scrollHeight;

        if (stableEndCount >= 2) {
            return;
        }

        await page.mouse.wheel(0, randomInt(850, 1200));
        await pause(page, 180, 320);

        if (Math.random() < 0.12) {
            await page.mouse.wheel(0, -randomInt(80, 180));
            await pause(page, 120, 260);
        }

        state = await getProfileRenderState(page);

        if (state.interestsReached && state.footerVisible && state.atBottom) {
            await page.mouse.wheel(0, randomInt(100, 220));
            await pause(page, 180, 320);
        }
    }
}

async function waitForProfileContent(page) {
    await page.locator(SELECTORS.main).first().waitFor({
        state: "visible",
        timeout: TIMEOUTS.contentMs
    });

    await page.waitForFunction(() => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const main = document.querySelector("main");
        const topCard = [...document.querySelectorAll("main section")]
            .find(section => section.getAttribute("componentkey")?.toLowerCase().includes("topcard"));
        const hasName = !!(
            main?.querySelector("h1") ||
            topCard?.querySelector("h2") ||
            topCard?.querySelector("a[href*='/in/']")
        );
     const sectionCount = [...document.querySelectorAll("main section h2, main section h3")]
    .filter(heading =>
        /^(about|activity|experience|education|skills)\b/i.test(
            clean(heading.innerText)
        )
    ).length;

return hasName && sectionCount >= 3;
    }, {
        timeout: TIMEOUTS.contentMs
    }).catch(() => {});
}

async function waitBetweenProfiles(page) {
const waitTime = randomInt(2500, 5000);
    console.log("Waiting " + Math.round(waitTime / 1000) + " seconds...");
    await pause(page, Math.floor(waitTime * 0.45), Math.floor(waitTime * 0.65));

    if (Math.random() < 0.7) {
        await page.mouse.wheel(0, -randomInt(120, 360));
    }

    await pause(page, Math.floor(waitTime * 0.25), Math.floor(waitTime * 0.45));
}

async function scrapeProfile(page) {
    page.setDefaultTimeout(TIMEOUTS.profileMs);
    page.setDefaultNavigationTimeout(TIMEOUTS.pageLoadMs);

    if (isUnexpectedLinkedInUrl(page.url())) {
        throw new Error("Profile unavailable or LinkedIn session needs attention.");
    }

    await page.waitForLoadState("domcontentloaded", {
        timeout: TIMEOUTS.contentMs
    });

    await waitForProfileContent(page);
    await pause(page, 300, 900);
    await humanReadProfile(page);
    await finishProfileRendering(page);

    const currentUrl = page.url();

    if (isUnexpectedLinkedInUrl(currentUrl)) {
        throw new Error("Profile unavailable or LinkedIn session needs attention.");
    }

    const header = await extractHeader(page);
    const about = await extractAbout(page);
    let experience = await extractExperienceSection(page);

    // LinkedIn can render the Experience heading before the card text settles.
    // If the section is visible but parsed empty, do one small human-style nudge
    // and retry once instead of writing a false empty array.
    if (!experience.length && await hasExperienceSection(page)) {
        await page.mouse.wheel(0, -randomInt(120, 260));
        await pause(page, 180, 360);
        await page.mouse.wheel(0, randomInt(420, 760));
        await pause(page, 450, 850);
        experience = await extractExperienceSection(page);
    }

    const education = await extractEducation(page);
    const skills = await extractSkills(page);
    const currentCompany = header.current_company ||
        (experience[0] ? experience[0].company : "");
    const position = (experience[0] ? experience[0].title : "") ||
        header.position ||
        header.headline;

    return {
        name: header.name,
        linkedin_url: normalizeProfileUrl(page.url()),
        headline: header.headline,
        location: header.location,
        about,
        current_company: currentCompany,
        position,
        followers: header.followers,
        connections: header.connections,
        experience,
        education,
        skills,
        company: currentCompany,
        college: education[0] ? education[0].school : ""
    };
}

async function findAndOpenProfile(page, mutualProfile) {
    const expectedUrl = normalizeProfileUrl(mutualProfile.linkedin_url);
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const suggestions = await searchProfile(page, mutualProfile);
            const count = await suggestions.count();

            console.log("Suggestions found:", count);

            for (let i = 0; i < count; i++) {
                const suggestion = suggestions.nth(i);
                const href = await suggestion.getAttribute("href");
                const suggestionUrl = normalizeProfileUrl(href || "");

                if (suggestionUrl === expectedUrl) {
                    await openVerifiedProfile(page, suggestion, expectedUrl);
                    return;
                }
            }

            throw new Error(
                'Could not find "' +
                mutualProfile.name +
                '" in search suggestions.'
            );
        } catch (err) {
            lastError = err;

            if (attempt >= 2) {
                break;
            }

            console.log("Search attempt failed. Retrying from LinkedIn Home:", err.message);
            await openLinkedInHome(page);
            await pause(page, 1200, 2600);
        }
    }

    throw lastError;
}

function profileMatchesTarget(profile, target) {

    const profileCompany = normalizeCompanyName(
        profile.company
    );

    const targetCompany = normalizeCompanyName(
        target.company
    );

    const sameCompany =
        profileCompany &&
        targetCompany &&
        (
            profileCompany.includes(targetCompany) ||
            targetCompany.includes(profileCompany)
        );

    const profileCollege = cleanText(
        profile.college
    ).toLowerCase();

    const targetCollege = cleanText(
        target.college
    ).toLowerCase();

    const sameCollege =
        profileCollege &&
        targetCollege &&
        (
            profileCollege.includes(targetCollege) ||
            targetCollege.includes(profileCollege)
        );

    return sameCompany || sameCollege;
}

async function browseHomeFeed(page, minDurationMs, maxDurationMs, label) {
    await openLinkedInHome(page);
    console.log(label);

    const duration = randomInt(minDurationMs, maxDurationMs);
    const started = Date.now();

while (Date.now() - started < duration) {

    // If we've been reading for at least 5 seconds,
    // check whether the important profile sections are loaded.
    if (Date.now() - started > 5000) {

        const loaded = await page.evaluate(() => {

            const text = document.body.innerText.toLowerCase();

            return (
                text.includes("experience") &&
                text.includes("education")
            );

        });

        if (loaded) {

            console.log(
                "Important sections loaded. Finishing reading."
            );

            break;
        }
    }        const viewport = page.viewportSize();

        if (viewport) {
            await page.mouse.move(
                randomInt(120, Math.max(160, viewport.width - 180)),
                randomInt(130, Math.max(160, viewport.height - 160)),
                {
                    steps: randomInt(10, 28)
                }
            );
        }

        await page.mouse.wheel(0, randomInt(240, 760));
        await pause(page, 650, 2100);

        if (Math.random() < 0.18) {
            await page.mouse.wheel(0, -randomInt(100, 340));
            await pause(page, 500, 1500);
        }

        if (Math.random() < 0.2) {
            await pause(page, 900, 2600);
        }
    }

    await pause(page, 1600, 3600);
}

async function browseHomeFeedBeforeClose(page) {
    await browseHomeFeed(
        page,
        15000,
        20000,
        "Browsing home feed before closing..."
    );
}

async function takeSessionBreak(page) {
    await browseHomeFeed(
        page,
        45000,
        90000,
        "Taking a natural home-feed break..."
    );
}

function logProgress(index, total, profile) {
    console.log("");
    console.log("--------------------------------");
    console.log("[" + index + " / " + total + "]");
    console.log("Opening:");
    console.log(profile.name);
    console.log(profile.linkedin_url);
    console.log("--------------------------------");
}

function logExtractedProfile(profile) {
    console.log((profile.name ? "OK" : "--") + " Name");
    console.log((profile.company ? "OK" : "--") + " Company");
    console.log((profile.location ? "OK" : "--") + " Location");
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
    let processedSinceBreak = 0;
    let nextSessionBreak = randomInt(15, 25);

    try {
        const mutualProfiles = await loadMutuals();
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
        console.log("Profiles:", mutualProfiles.length);
        console.log("Already scraped:", scrapedUrls.size);

        await saveResults(results);

        session = await startBrowser();
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

        await openLinkedInHome(session.page);

        for (const [index, mutualProfile] of mutualProfiles.entries()) {
            const normalizedUrl = normalizeProfileUrl(mutualProfile.linkedin_url);

            if (scrapedUrls.has(normalizedUrl)) {
                console.log("Skipping already scraped:", mutualProfile.name);
                continue;
            }

            logProgress(index + 1, mutualProfiles.length, mutualProfile);

            try {
                await findAndOpenProfile(session.page, mutualProfile);

                const profile = await scrapeProfile(session.page);

                if (normalizeProfileUrl(profile.linkedin_url) !== normalizedUrl) {
                    throw new Error("Scraped profile URL did not match the requested profile.");
                }

                processedSinceBreak += 1;

                const shouldTakeSessionBreak =
                    processedSinceBreak >= nextSessionBreak &&
                    index < mutualProfiles.length - 1;

                results.push(profile);
                scrapedUrls.add(normalizedUrl);
                scrapedCount += 1;

                logExtractedProfile(profile);
                await saveResults(results);
                console.log("Saved to data/mutual-details.json");
console.log("------------");
console.log("Company:", profile.company);
console.log("Target Company:", target.company);
console.log("College:", profile.college);
console.log("Target College:", target.college);
console.log("------------");

                if (!profileMatchesTarget(profile, target)) {
                    console.log("No company or college match.");

                    if (shouldTakeSessionBreak) {
                        await takeSessionBreak(session.page);
                        processedSinceBreak = 0;
                        nextSessionBreak = randomInt(15, 25);
                    } else {
                        await waitBetweenProfiles(session.page);
                    }

                    continue;
                }

                if (shouldTakeSessionBreak) {
                    await takeSessionBreak(session.page);
                    processedSinceBreak = 0;
                    nextSessionBreak = randomInt(15, 25);
                } else {
                    await waitBetweenProfiles(session.page);
                }
            } catch (err) {
                failedCount += 1;
                console.error("Profile failed:", err.message);

                try {
                    await openLinkedInHome(session.page);
                } catch (recoveryErr) {
                    console.error("Recovery failed:", recoveryErr.message);
                }
            }
        }

        if (session && session.page) {
            await browseHomeFeedBeforeClose(session.page).catch(err => {
                console.error("Final feed browse failed:", err.message);
            });
        }

        logSummary(startedAt, scrapedCount, failedCount);
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
    extractCollege,
    extractLocation,
    extractAbout,
    extractConnectionStatus,
    scrapeProfile,
    saveResults,
    loadMutuals,
    loadExistingResults,
    openLinkedInHome,
    searchProfile,
    openVerifiedProfile,
    humanReadProfile,
    waitBetweenProfiles,
    browseHomeFeedBeforeClose,
    main
};
