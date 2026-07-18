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
    extractExperience: extractExperienceSection
} = require("./extractors/experience");
const {
    parseDurationRange
} = require("../utils/DurationParser");
const {
    extractEducation
} = require("./extractors/education");
const {
    extractSkills
} = require("./extractors/skills");
const {
    debugLog
} = require("../utils/DebugLogger");
const {
    HUMAN_BEHAVIOR_CONFIG
} = require("../utils/HumanBehaviorConfig");
const {
    writeJsonAtomic
} = require("../utils/JsonFileStore");
const {
    chooseSearchStrategy,
    fullNameSearchStrategy
} = require("../utils/SearchStrategy");
const {
    scoreProfileSuggestion,
    scoreToPercent
} = require("../utils/ProfileVerification");
const {
    isNullableNumber,
    normalizeNumericField
} = require("../utils/NumericNormalizer");
const {
    performInitialHomeFeedCommentSession,
    performHumanBrowsingSession
} = require("./HumanActivity");
const LINKEDIN_HOME_URL = "https://www.linkedin.com/feed/";
const DATA_DIR = path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(__dirname, "..", "data"));
const MUTUALS_PATH = path.join(DATA_DIR, "mutuals.json");
const OUTPUT_PATH = path.join(DATA_DIR, "mutual-details.json");
const TARGET_PATH = path.join(DATA_DIR, "target.json");

const TIMEOUTS = {
    profileMs: 130000,
    pageLoadMs: 45000,
    contentMs: 12000,
    searchBoxMs: 10000,
    suggestionsMs: 9000,
    navigationMs: 16000,
    networkIdleMs: 2500
};

const HUMAN_READING = {
    minimumTopCardMs: 3500,
    minimumProfileMs: 65000,
    maximumProfileMs: 95000,
    bottomArrivalWindowMs: 6000,
    scrollMinPx: 120,
    scrollMaxPx: 400,
    correctionMinPx: 80,
    correctionMaxPx: 180,
    shortPauseMinMs: 220,
    shortPauseMaxMs: 650,
    readPauseMinMs: 900,
    readPauseMaxMs: 2200,
    longReadPauseMinMs: 2200,
    longReadPauseMaxMs: 4800
};

const SELECTORS = {
    main: "main",
    searchInput: 'input[placeholder*="Search"]',
    searchSuggestions: '[role="listbox"] a[href*="/in/"]'
};

function displayStrategyLabel(strategy) {
    return cleanText(strategy?.label)
        .replace(/\b\w/g, char => char.toUpperCase());
}

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function pause(page, minMs, maxMs) {
    if (!page || page.isClosed()) {
        throw new Error("Active LinkedIn page closed during human pause.");
    }

    await page.waitForTimeout(randomInt(minMs, maxMs)).catch(err => {
        if (/Target page, context or browser has been closed/i.test(err.message)) {
            throw new Error("Active LinkedIn page closed during human pause.");
        }

        throw err;
    });
}

function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
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

function formatMilliseconds(durationMs) {
    const elapsedSeconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    if (minutes > 0) {
        return minutes + "m " + seconds + "s";
    }

    return seconds + "s";
}

function averageProfileMs(profileTimings) {
    if (!profileTimings.length) {
        return 0;
    }

    return Math.round(
        profileTimings.reduce((total, value) => total + value, 0) /
        profileTimings.length
    );
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
            linkedin_url: normalizeProfileUrl(profile.linkedin_url),
            company: cleanText(profile.company),
            headline: cleanText(profile.headline),
            location: cleanText(profile.location),
            position: cleanText(profile.position),
            current_company: cleanText(profile.current_company)
        }));
    const uniqueProfiles = new Map();

    for (const profile of mutualProfiles) {
        const normalizedUrl = normalizeProfileUrl(profile.linkedin_url);
        const existing = uniqueProfiles.get(normalizedUrl);

        if (!existing || profile.name.length > existing.name.length) {
            uniqueProfiles.set(normalizedUrl, profile);
        }
    }

    return [...uniqueProfiles.values()];
}

async function loadExistingResults() {
    try {
        const existingResults = await readJsonFile(
            OUTPUT_PATH,
            "data/mutual-details.json does not exist yet."
        );

        if (!Array.isArray(existingResults)) {
            console.log("Warning: ignoring existing data/mutual-details.json because it is not an array.");
            return [];
        }

        const uniqueResults = new Map();

        for (const result of existingResults) {
            const normalizedUrl = normalizeProfileUrl(result?.linkedin_url);

            if (!normalizedUrl) {
                continue;
            }

            uniqueResults.set(normalizedUrl, {
                ...result,
                linkedin_url: normalizedUrl
            });
        }

        return [...uniqueResults.values()];
    } catch (err) {
        if (err.message.includes("does not exist yet")) {
            return [];
        }

        console.log("Warning: ignoring existing data/mutual-details.json:", err.message);
        return [];
    }
}

async function saveResults(results) {
    await writeJsonAtomic(OUTPUT_PATH, normalizeProfilesForJson(results));
}

function normalizeProfilesForJson(results) {
    return Array.isArray(results)
        ? results.map(normalizeProfileForJson)
        : [];
}

function normalizeProfileForJson(profile = {}) {
    const normalized = copyCoreProfileFields({
        name: profile.name,
        linkedin_url: profile.linkedin_url,
        headline: profile.headline,
        location: profile.location,
        about: profile.about,
        current_company: profile.current_company,
        position: profile.position,
        followers: normalizeNumericField(profile.followers),
        connections: normalizeNumericField(profile.connections),
        experience: Array.isArray(profile.experience) ? profile.experience : [],
        education: Array.isArray(profile.education) ? profile.education : [],
        skills: Array.isArray(profile.skills) ? profile.skills : [],
        relationship_evidence: profile.relationship_evidence,
        role: profile.role,
        seniority: profile.seniority,
        decision_power: profile.decision_power,
        hiring_influence: profile.hiring_influence
    });

    validateNullableNumber(normalized.followers, "followers");
    validateNullableNumber(normalized.connections, "connections");

    return normalized;
}

function copyCoreProfileFields(profile) {
    return Object.fromEntries(
        Object.entries(profile).filter(([, value]) => value !== undefined)
    );
}

function validateNullableNumber(value, field) {
    if (!isNullableNumber(value)) {
        throw new TypeError(`${field} must be a number or null before writing JSON.`);
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

    const targetX = box.x + box.width * (0.35 + Math.random() * 0.3);
    const targetY = box.y + box.height * (0.35 + Math.random() * 0.3);
    const viewport = page.viewportSize();
    const startX = viewport ? randomInt(80, Math.max(100, viewport.width - 120)) : targetX;
    const startY = viewport ? randomInt(90, Math.max(110, viewport.height - 120)) : targetY;
    const midX = Math.round((startX + targetX) / 2 + randomInt(-120, 120));
    const midY = Math.round((startY + targetY) / 2 + randomInt(-80, 80));

    await page.mouse.move(startX, startY, {
        steps: randomInt(5, 12)
    }).catch(() => {});
    await page.mouse.move(midX, midY, {
        steps: randomInt(8, 18)
    }).catch(() => {});
    if (Math.random() < 0.22) {
        await page.mouse.move(targetX + randomInt(-20, 20), targetY + randomInt(-14, 14), {
            steps: randomInt(4, 10)
        }).catch(() => {});
        await pause(page, 80, 240);
    }
    await page.mouse.move(targetX, targetY, {
        steps: randomInt(8, 20)
    });

    await pause(page, 180, 460);
}

async function naturalClick(page, locator, label) {
    await moveMouseToLocator(page, locator, label);
    await locator.hover({
        timeout: TIMEOUTS.contentMs
    }).catch(() => {});
    await pause(page, 300, 800);

    await locator.click({
        delay: randomInt(70, 180),
        timeout: TIMEOUTS.contentMs
    });
}

async function scrollProfile(page, distance) {
    try {
        return await page.evaluate(deltaY => {
            const isScrollable = element => {
                if (!element) {
                    return false;
                }

                const style = window.getComputedStyle(element);
                const overflowY = style.overflowY;

                return (
                    element.scrollHeight > element.clientHeight + 80 &&
                    /(auto|scroll|overlay|visible)/i.test(overflowY)
                );
            };
            const visibleArea = element => {
                if (element === document.documentElement || element === document.body) {
                    return window.innerWidth * window.innerHeight;
                }

                const box = element.getBoundingClientRect();
                const width = Math.max(0, Math.min(box.right, window.innerWidth) - Math.max(box.left, 0));
                const height = Math.max(0, Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0));

                return width * height;
            };
            const canMove = element => {
                if (!element) {
                    return false;
                }

                if (deltaY > 0) {
                    return element.scrollTop + element.clientHeight < element.scrollHeight - 4;
                }

                return element.scrollTop > 4;
            };
            const candidates = [
                document.scrollingElement,
                document.documentElement,
                document.body,
                ...document.querySelectorAll("main, main *, div, section")
            ]
                .filter(isScrollable)
                .filter(element => visibleArea(element) > 20000)
                .sort((a, b) => {
                    const aCanMove = canMove(a) ? 1 : 0;
                    const bCanMove = canMove(b) ? 1 : 0;

                    if (aCanMove !== bCanMove) {
                        return bCanMove - aCanMove;
                    }

                    return visibleArea(b) - visibleArea(a);
                });
            const target = candidates[0] || document.scrollingElement || document.documentElement;
            const beforeTop = target.scrollTop;

            if (target === document.documentElement || target === document.body || target === document.scrollingElement) {
                window.scrollBy({
                    top: deltaY,
                    behavior: "auto"
                });
            } else {
                target.scrollBy({
                    top: deltaY,
                    behavior: "auto"
                });
            }

            return {
                tag: target.tagName,
                id: target.id || "",
                className: String(target.className || "").slice(0, 120),
                beforeTop,
                afterTop: target.scrollTop,
                scrollHeight: target.scrollHeight,
                clientHeight: target.clientHeight
            };
        }, distance);
    } catch (err) {
        if (!page.isClosed()) {
            await page.mouse.wheel(0, distance).catch(() => {});
        }

        return null;
    }
}

async function typeLikeHuman(page, text) {
    const value = cleanText(text);

    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        const keyDelay = Math.random() < 0.18
            ? randomInt(70, 140)
            : randomInt(120, 280);

        await page.keyboard.type(char, {
            delay: keyDelay
        });

        if (char === " ") {
            await pause(page, 220, 520);
        } else if (Math.random() < 0.14) {
            await pause(page, 180, 720);
        }

        if (
            index > 1 &&
            index < value.length - 1 &&
            Math.random() < 0.035
        ) {
            const typo = "abcdefghijklmnopqrstuvwxyz"[randomInt(0, 25)];

            await page.keyboard.type(typo, {
                delay: randomInt(60, 130)
            });
            await pause(page, 180, 420);
            await page.keyboard.press("Backspace");
            await pause(page, 120, 300);
        }
    }
}

async function openLinkedInHome(page) {
    const searchInput = page.locator(SELECTORS.searchInput).first();
    const alreadyOnHome = /linkedin\.com\/feed\/?/i.test(page.url());

    if (
        alreadyOnHome &&
        await searchInput.isVisible({ timeout: 1500 }).catch(() => false)
    ) {
        await pause(page, 2000, 5000);
        return;
    }

    await page.goto(LINKEDIN_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUTS.pageLoadMs
    });

    if (isUnexpectedLinkedInUrl(page.url())) {
        throw new Error("LinkedIn redirected to a login, checkpoint, or unavailable page.");
    }

    await searchInput.waitFor({
        state: "visible",
        timeout: TIMEOUTS.searchBoxMs
    });

    await pause(page, 2000, 5000);
}

async function ensureLivePage(session) {
    const browser = session.context.browser();

    if (!browser || !browser.isConnected()) {
        throw new Error("Browser is no longer connected.");
    }

    if (!session.page || session.page.isClosed()) {
        throw new Error("Active page has been closed.");
    }

    return session.page;
}

async function moveMouseSlightly(page) {
    const viewport = page.viewportSize();

    if (!viewport) {
        return;
    }

    const x = randomInt(80, Math.max(120, viewport.width - 120));
    const y = randomInt(90, Math.max(130, viewport.height - 120));

    await page.mouse.move(
        x + randomInt(-80, 80),
        y + randomInt(-45, 45),
        {
            steps: randomInt(5, 12)
        }
    ).catch(() => {});
    await page.mouse.move(x, y, {
        steps: randomInt(6, 18)
    });
}

async function prepareForMutualSearch(page) {
    console.log("--------------------------------");
    console.log("Searching mutual...");
    await pause(
        page,
        HUMAN_BEHAVIOR_CONFIG.minSearchDelayMs,
        HUMAN_BEHAVIOR_CONFIG.maxSearchDelayMs
    );
    await moveMouseSlightly(page);
}

async function runProfileSearch(page, mutualProfile, strategy = null) {
    const searchBox = page.locator(SELECTORS.searchInput).first();
    const searchStrategy = strategy || chooseSearchStrategy(
        mutualProfile.name,
        HUMAN_BEHAVIOR_CONFIG
    );

    if (!(await searchBox.isVisible({ timeout: 3000 }).catch(() => false))) {
        console.log("Warning: search box not visible. Recovering via LinkedIn Home.");
        await openLinkedInHome(page);
    }

    await prepareForMutualSearch(page);
    console.log("Strategy selected:");
    console.log(displayStrategyLabel(searchStrategy));
    console.log("Typed:");
    console.log(`"${searchStrategy.query}"`);
    await naturalClick(page, searchBox, "Search box");
    await pause(page, 500, 1500);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await pause(page, 180, 420);
    await page.keyboard.press("Backspace");
    await pause(page, 220, 520);
    await typeLikeHuman(page, searchStrategy.query);
    await pause(page, 1000, 2000);

    const suggestions = page.locator(SELECTORS.searchSuggestions);

    await suggestions.first().waitFor({
        state: "visible",
        timeout: TIMEOUTS.suggestionsMs
    });

    const suggestionDelay = randomInt(
        HUMAN_BEHAVIOR_CONFIG.minSuggestionDelayMs,
        HUMAN_BEHAVIOR_CONFIG.maxSuggestionDelayMs
    );

    console.log(
        "Waiting",
        (suggestionDelay / 1000).toFixed(1),
        "seconds before selecting suggestion..."
    );
    await page.waitForTimeout(suggestionDelay);
    await moveMouseSlightly(page);
    console.log("Suggestions loaded...");
    console.log("Reading search suggestions...");
    await pause(page, 1500, 2200);

    return {
        suggestions,
        strategy: searchStrategy
    };
}

async function searchProfile(page, mutualProfile, strategy = null) {
    const searchResult = await runProfileSearch(page, mutualProfile, strategy);

    return searchResult.suggestions;
}

async function openVerifiedProfile(page, suggestion, expectedUrl) {
    const href = await suggestion.getAttribute("href");
    const suggestionUrl = normalizeProfileUrl(href || "");

    if (suggestionUrl !== expectedUrl) {
        throw new Error("Search suggestion URL did not match the expected profile.");
    }

    console.log("Opening profile:", expectedUrl);
    await naturalClick(page, suggestion, "Suggestion");

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
        timeout: TIMEOUTS.networkIdleMs
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

    await pause(page, 3000, 6000);
}

async function getSuggestionVerification(suggestion, mutualProfile) {
    const href = await suggestion.getAttribute("href");
    const text = await suggestion.innerText().catch(() => "");
    const verification = scoreProfileSuggestion(
        {
            href,
            text
        },
        mutualProfile,
        {
            normalizeProfileUrl,
            threshold: HUMAN_BEHAVIOR_CONFIG.profileVerificationThreshold
        }
    );

    console.log(
        "Profile verification score:",
        scoreToPercent(verification.score),
        verification.reasons.length
            ? `(${verification.reasons.join(", ")})`
            : "(no matching verification signals)"
    );
    console.log("Verification fields available:", verification.fieldChecks);
    console.log("Verification fields matched:", verification.fieldMatches);

    return {
        suggestion,
        verification
    };
}

async function findBestVerifiedSuggestion(page, suggestions, mutualProfile) {
    const count = await suggestions.count();
    let bestMatch = null;

    for (let i = 0; i < count; i++) {
        const suggestion = suggestions.nth(i);

        if (i === 0 || Math.random() < 0.35) {
            await moveMouseToLocator(page, suggestion, "Search suggestion").catch(() => {});
            await pause(page, 300, 800).catch(() => {});
        }

        const candidate = await getSuggestionVerification(
            suggestion,
            mutualProfile
        );

        if (
            !bestMatch ||
            candidate.verification.score > bestMatch.verification.score
        ) {
            bestMatch = candidate;
        }

        if (candidate.verification.verified) {
            console.log(
                "Verified profile with confidence",
                scoreToPercent(candidate.verification.score)
            );
            console.log("Correct profile identified.");
            await moveMouseToLocator(page, suggestion, "Verified search suggestion").catch(() => {});
            await pause(page, 300, 800).catch(() => {});
            return candidate;
        }
    }

    return bestMatch;
}

async function getProfileRenderState(page) {
    return page.evaluate(() => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const getScrollState = () => {
            const isScrollable = element => {
                if (!element) {
                    return false;
                }

                return element.scrollHeight > element.clientHeight + 80;
            };
            const visibleArea = element => {
                if (element === document.documentElement || element === document.body) {
                    return window.innerWidth * window.innerHeight;
                }

                const box = element.getBoundingClientRect();
                const width = Math.max(0, Math.min(box.right, window.innerWidth) - Math.max(box.left, 0));
                const height = Math.max(0, Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0));

                return width * height;
            };
            const candidates = [
                document.scrollingElement,
                document.documentElement,
                document.body,
                ...document.querySelectorAll("main, main *, div, section")
            ]
                .filter(isScrollable)
                .filter(element => visibleArea(element) > 20000)
                .sort((a, b) => visibleArea(b) - visibleArea(a));
            const target = candidates[0] || document.scrollingElement || document.documentElement;
            const scrollTop = target === document.documentElement || target === document.body
                ? window.scrollY
                : target.scrollTop;

            return {
                scrollTop,
                scrollHeight: target.scrollHeight || document.documentElement.scrollHeight,
                viewportHeight: target.clientHeight || window.innerHeight,
                containerTag: target.tagName || "",
                containerId: target.id || "",
                containerClass: String(target.className || "").slice(0, 120)
            };
        };
        const main = document.querySelector("main");
        const scrollState = getScrollState();

if (!main) {
    return {
        scrollY: scrollState.scrollTop,
        scrollHeight: scrollState.scrollHeight,
        viewportHeight: scrollState.viewportHeight,
        atBottom: false,
        footerVisible: false,
        interestsReached: false,
        hasAbout: false,
        hasExperience: false,
        hasEducation: false,
        hasSkills: false,
        requiredSectionsLoaded: false,
        headings: [],
        scrollContainer: scrollState
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
    scrollY: scrollState.scrollTop,
    scrollHeight: scrollState.scrollHeight,
    viewportHeight: scrollState.viewportHeight,
    atBottom: scrollState.scrollTop + scrollState.viewportHeight >=
        scrollState.scrollHeight - 120,
    footerVisible,
    interestsReached,
    hasAbout: hasSection(/^About$/i),
    hasExperience: hasSection(/^Experience$/i),
    hasEducation: hasSection(/^Education$/i),
    hasSkills: hasSection(/^Skills(?:\s+\(\d+\))?$/i),
    requiredSectionsLoaded:
        hasSection(/^About$/i) &&
        hasSection(/^Experience$/i) &&
        hasSection(/^Education$/i) &&
        hasSection(/^Skills(?:\s+\(\d+\))?$/i),

    headings: headingTexts,
    scrollContainer: scrollState
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
        hasSkills: false,
        requiredSectionsLoaded: false,
        headings: [],
        scrollContainer: null
    }));
}

function createReadSession() {
    return {
        startedAt: Date.now(),
        targetProfileMs: randomInt(
            HUMAN_READING.minimumProfileMs,
            HUMAN_READING.maximumProfileMs
        ),
        downwardScrolls: 0,
        stableEndCount: 0,
        previousHeight: 0,
        seen: {
            about: false,
            experience: false,
            education: false,
            skills: false,
            interests: false
        }
    };
}

function elapsedSessionMs(session) {
    return Date.now() - session.startedAt;
}

function remainingProfileReadMs(session) {
    return Math.max(0, session.targetProfileMs - elapsedSessionMs(session));
}

function updateReadSession(session, state) {
    session.seen.about ||= state.hasAbout;
    session.seen.experience ||= state.hasExperience;
    session.seen.education ||= state.hasEducation;
    session.seen.skills ||= state.hasSkills;
    session.seen.interests ||= state.interestsReached;

    const heightStable = session.previousHeight > 0 &&
        Math.abs(state.scrollHeight - session.previousHeight) < 80;
    const naturalEndReached =
        state.atBottom &&
        heightStable &&
        (hasRequiredSections(session) || session.seen.interests);

    session.previousHeight = state.scrollHeight;
    session.stableEndCount = naturalEndReached ? session.stableEndCount + 1 : 0;
}

function hasRequiredSections(session) {
    return session.seen.about &&
        session.seen.experience &&
        session.seen.education &&
        session.seen.skills;
}

function shouldContinueReading(session) {
    if (elapsedSessionMs(session) < session.targetProfileMs) {
        return true;
    }

    if (
        hasRequiredSections(session)
    ) {
        return false;
    }

    if (
        session.stableEndCount >= 2
    ) {
        return false;
    }

    return false;
}

function getScrollMetrics(state) {
    const maxScroll = Math.max(0, state.scrollHeight - state.viewportHeight);
    const remainingScroll = Math.max(0, maxScroll - state.scrollY);

    return {
        maxScroll,
        remainingScroll,
        scrollProgress: maxScroll > 0 ? state.scrollY / maxScroll : 1
    };
}

function getTimeProgress(session) {
    return Math.min(1, elapsedSessionMs(session) / session.targetProfileMs);
}

function isScrollAheadOfReading(session, state) {
    const metrics = getScrollMetrics(state);
    const timeProgress = getTimeProgress(session);

    return metrics.scrollProgress > timeProgress + 0.08;
}

function shouldArriveAtBottom(session) {
    return remainingProfileReadMs(session) <= HUMAN_READING.bottomArrivalWindowMs;
}

async function boundedPause(page, session, minMs, maxMs) {
    const remainingMs = remainingProfileReadMs(session);

    if (remainingMs <= 0) {
        return;
    }

    await page.waitForTimeout(Math.min(
        remainingMs,
        randomInt(minMs, maxMs)
    )).catch(err => {
        console.log("Human reading pause skipped:", err.message);
    });
}

async function moveMouseNaturally(page) {
    const viewport = page.viewportSize();

    if (!viewport) {
        return;
    }

    const startX = randomInt(90, Math.max(120, viewport.width - 140));
    const startY = randomInt(90, Math.max(120, viewport.height - 140));
    const endX = randomInt(100, Math.max(130, viewport.width - 160));
    const endY = randomInt(100, Math.max(130, viewport.height - 160));
    const midX = Math.round((startX + endX) / 2 + randomInt(-120, 120));
    const midY = Math.round((startY + endY) / 2 + randomInt(-80, 80));

    await page.mouse.move(startX, startY, {
        steps: randomInt(5, 12)
    }).catch(() => {});
    await page.mouse.move(midX, midY, {
        steps: randomInt(8, 18)
    }).catch(() => {});
    if (Math.random() < 0.22) {
        await page.mouse.move(endX + randomInt(-22, 22), endY + randomInt(-16, 16), {
            steps: randomInt(4, 9)
        }).catch(() => {});
        await boundedPause(page, {
            startedAt: Date.now(),
            targetProfileMs: 400
        }, 80, 220);
    }
    await page.mouse.move(endX, endY, {
        steps: randomInt(8, 20)
    }).catch(() => {});
}

function nextHumanScrollDistance(session, state) {
    const metrics = getScrollMetrics(state);
    const remainingMsBeforeBottom = Math.max(
        1,
        remainingProfileReadMs(session) - HUMAN_READING.bottomArrivalWindowMs
    );
    const expectedRemainingScrolls = Math.max(
        1,
        Math.ceil(remainingMsBeforeBottom / randomInt(3500, 6500))
    );
    const ranges = [
        [100, 250],
        [250, 450],
        [450, 700],
        [700, 1000]
    ];
    const selectedRange = ranges[randomInt(0, ranges.length - 1)];
    const pacedDistance = Math.ceil(
        metrics.remainingScroll / expectedRemainingScrolls
    );
    const canCorrectUp =
        session.downwardScrolls >= 2 &&
        Math.random() < 0.10 &&
        !shouldArriveAtBottom(session);

    if (canCorrectUp) {
        return -randomInt(
            HUMAN_READING.correctionMinPx,
            HUMAN_READING.correctionMaxPx
        );
    }

    if (metrics.remainingScroll <= 0) {
        return 0;
    }

    if (
        !shouldArriveAtBottom(session) &&
        metrics.remainingScroll < HUMAN_READING.scrollMinPx
    ) {
        return 0;
    }

    session.downwardScrolls += 1;
    return Math.min(
        metrics.remainingScroll,
        Math.max(
            selectedRange[0],
            Math.min(selectedRange[1], pacedDistance)
        )
    );
}

async function hoverProfileAmbientElement(page) {
    if (Math.random() > 0.24) {
        return;
    }

    const selectors = [
        "main img",
        "main h1",
        "main button",
        "main a[href*='/company/']",
        "main section"
    ];
    const selector = selectors[randomInt(0, selectors.length - 1)];
    const candidates = await page.locator(selector).elementHandles().catch(() => []);
    const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 5);

    for (const candidate of shuffled) {
        const box = await candidate.boundingBox().catch(() => null);

        if (!box || box.width < 20 || box.height < 20) {
            continue;
        }

        await candidate.hover({
            timeout: 1200
        }).catch(() => {});
        await pause(page, 300, 1200).catch(() => {});
        return;
    }
}

async function pauseForNewProfileSections(page, session, previousSeen, state) {
    const pauses = [];

    if (!previousSeen.about && state.hasAbout) {
        pauses.push(["About", 4000, 8000]);
    }

    if (!previousSeen.experience && state.hasExperience) {
        pauses.push(["Experience", 5000, 10000]);
    }

    if (!previousSeen.education && state.hasEducation) {
        pauses.push(["Education", 3000, 6000]);
    }

    if (!previousSeen.skills && state.hasSkills) {
        pauses.push(["Skills", 2000, 4000]);
    }

    for (const [label, minMs, maxMs] of pauses) {
        console.log("Reading " + label + "...");
        await hoverProfileAmbientElement(page);
        await boundedPause(page, session, minMs, maxMs);
    }
}

async function performHumanScroll(page, session, state) {
    if (Math.random() < 0.75) {
        await moveMouseNaturally(page);
        await hoverProfileAmbientElement(page);
        await boundedPause(
            page,
            session,
            HUMAN_READING.shortPauseMinMs,
            HUMAN_READING.shortPauseMaxMs
        );
    }

    if (state.atBottom && !shouldArriveAtBottom(session)) {
        await scrollProfile(page, -randomInt(
            HUMAN_READING.correctionMinPx,
            HUMAN_READING.correctionMaxPx
        ));
        await boundedPause(
            page,
            session,
            HUMAN_READING.longReadPauseMinMs,
            HUMAN_READING.longReadPauseMaxMs
        );
        return;
    }

    if (isScrollAheadOfReading(session, state)) {
        await boundedPause(
            page,
            session,
            HUMAN_READING.longReadPauseMinMs,
            HUMAN_READING.longReadPauseMaxMs
        );
        return;
    }

    const distance = nextHumanScrollDistance(session, state);

    if (distance !== 0) {
        await scrollProfile(page, distance);
    }

    if (Math.random() < 0.10) {
        console.log("Idle reading pause...");
        await boundedPause(page, session, 6500, 12000);
    }

    await boundedPause(
        page,
        session,
        HUMAN_READING.readPauseMinMs,
        HUMAN_READING.readPauseMaxMs
    );
}

async function readCurrentViewport(page, session) {
    await moveMouseNaturally(page);
    await boundedPause(
        page,
        session,
        HUMAN_READING.readPauseMinMs,
        HUMAN_READING.readPauseMaxMs
    );
}

async function detectProfileSections(page) {
    return await getProfileRenderState(page);
}

// LinkedIn profile pages are React-rendered and inject lower sections lazily.
// Read naturally and stop as soon as About, Experience, Education, and Skills
// are available. Do not keep scrolling simply to satisfy a timer.
async function humanReadProfile(page) {
    console.log("Reading profile");

    const session = createReadSession();
    let latestState = await detectProfileSections(page);

    console.log("Profile reading target:", Math.round(session.targetProfileMs / 1000), "seconds.");
    await boundedPause(page, session, 1500, 3500);
    updateReadSession(session, latestState);
    await pauseForNewProfileSections(page, session, {
        about: false,
        experience: false,
        education: false,
        skills: false
    }, latestState);
    await readCurrentViewport(page, session);

    while (shouldContinueReading(session)) {
        const previousSeen = { ...session.seen };
        await performHumanScroll(page, session, latestState);
        latestState = await detectProfileSections(page);
        await pauseForNewProfileSections(page, session, previousSeen, latestState);
        updateReadSession(session, latestState);
    }

    if (remainingProfileReadMs(session) <= 0 && !hasRequiredSections(session)) {
        console.log("Warning: profile render wait reached safety timeout.");
    }

    return latestState;
}

// Keep extraction separate from reading: after the timed human read, only
// inspect render state. Do not add extra scrolling that can desync pacing.
async function finishProfileRendering(page, initialState = null) {
    return initialState || await detectProfileSections(page);
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
        const hasProfileText = clean(main?.innerText || "").length > 200;

return hasName && hasProfileText;
    }, undefined, {
        timeout: 8000
    }).catch(() => {});
}

async function getAvailableDetailSections(page) {
    try {
        return await page.evaluate(() => {
            const clean = value => (value || "").replace(/\s+/g, " ").trim();
            const headings = [...document.querySelectorAll(`
                main section h2,
                main section h3,
                main section [role="heading"],
                main section [aria-level]
            `)].map(heading => clean(heading.innerText));
            const hasHeading = pattern => headings.some(text => pattern.test(text));

            return {
                experience: !!document.querySelector("#experience") ||
                    hasHeading(/^Experience$/i),
                education: !!document.querySelector("#education") ||
                    hasHeading(/^Education$/i),
                skills: !!document.querySelector("#skills") ||
                    hasHeading(/^Skills(?:\s+\(\d+\))?$/i)
            };
        });
    } catch (err) {
        return {
            experience: false,
            education: false,
            skills: false
        };
    }
}

function availableSectionsFromState(state) {
    if (!state) {
        return null;
    }

    return {
        experience: state.hasExperience,
        education: state.hasEducation,
        skills: state.hasSkills
    };
}

async function retryEmptySections(page, sections, renderState = null) {
    const available = availableSectionsFromState(renderState) ||
        await getAvailableDetailSections(page);
    const shouldRetry =
        (available.experience && !sections.experience.length) ||
        (available.education && !sections.education.length) ||
        (available.skills && !sections.skills.length);

    if (!shouldRetry) {
        return sections;
    }

    console.log("Retry: empty visible sections.");
    await scrollProfile(page, -randomInt(
        HUMAN_READING.correctionMinPx,
        HUMAN_READING.correctionMaxPx
    ));
    await pause(page, 180, 360);
    await scrollProfile(page, randomInt(
        HUMAN_READING.scrollMinPx,
        HUMAN_READING.scrollMaxPx
    ));
    await pause(page, 450, 900);

    const retryTasks = [];

    if (available.experience && !sections.experience.length) {
        retryTasks.push(extractExperienceSection(page).then(value => {
            sections.experience = value;
        }));
    }

    if (available.education && !sections.education.length) {
        retryTasks.push(extractEducation(page).then(value => {
            sections.education = value;
        }));
    }

    if (available.skills && !sections.skills.length) {
        retryTasks.push(extractSkills(page).then(value => {
            sections.skills = value;
        }));
    }

    await Promise.all(retryTasks);
    return sections;
}

async function waitBetweenProfiles(page) {
    const waitTime = randomInt(900, 1800);

    await pause(page, Math.floor(waitTime * 0.45), Math.floor(waitTime * 0.6));

    if (Math.random() < 0.45) {
        await scrollProfile(page, -randomInt(120, 360));
    }

    await pause(page, Math.floor(waitTime * 0.25), Math.floor(waitTime * 0.4));
}

function normalizeCompareText(value) {
    return cleanText(value).toLowerCase();
}

function sameProfileValue(left, right) {
    const normalizedLeft = normalizeCompareText(left);
    const normalizedRight = normalizeCompareText(right);

    return !!(
        normalizedLeft &&
        normalizedRight &&
        (
            normalizedLeft === normalizedRight ||
            normalizedLeft.includes(normalizedRight) ||
            normalizedRight.includes(normalizedLeft)
        )
    );
}

function ensureCurrentExperienceMatchesHeader(experience, header) {
    const headerCompany = cleanText(header.current_company);
    const headerPosition = cleanText(header.position || header.headline);

    if (!headerCompany || !headerPosition) {
        return experience;
    }

    const matchesHeader = item =>
        sameProfileValue(item.company, headerCompany) &&
        sameProfileValue(item.title, headerPosition);
    const isCurrent = item => Boolean(item.duration?.currently_working);
    const currentIndex = experience.findIndex(item =>
        matchesHeader(item) && isCurrent(item)
    );

    if (currentIndex === 0) {
        return experience;
    }

    if (currentIndex > 0) {
        const reordered = experience.slice();
        const [currentRole] = reordered.splice(currentIndex, 1);

        return [currentRole, ...reordered];
    }

    console.warn("[experience-parser] current experience matching header was not extracted", {
        company: headerCompany,
        title: headerPosition,
        reason: "No extracted experience card matched the profile header; not fabricating a duration."
    });

    return experience;
}

function normalizeExperienceDurations(experience = []) {
    if (!Array.isArray(experience)) {
        return [];
    }

    return experience.map(item => ({
        ...item,
        duration: parseDurationRange(item?.duration || item?.duration_text || "")
    }));
}

function validateProfileExtraction(profile, header) {
    const warnings = [];
    const duplicateEducation = new Set();
    const seenEducation = new Set();
    const fakeSkills = profile.skills.filter(skill =>
        /^(endorse|show all|see more|add skill|follow|message|connect|open to work)$/i.test(skill) ||
        /^\d+\s+endorsements?$/i.test(skill)
    );

    if (!profile.name) {
        warnings.push("name is empty");
    }

    if (!profile.headline) {
        warnings.push("headline is empty");
    }

    for (const item of profile.education) {
        const key = [
            item.school,
            item.degree,
            item.field_of_study,
            item.dates
        ].map(normalizeCompareText).join("|");

        if (seenEducation.has(key)) {
            duplicateEducation.add(key);
        }

        seenEducation.add(key);
    }

    if (!sameProfileValue(profile.position, header.position || header.headline)) {
        warnings.push("position does not match profile header");
    }

    if (!sameProfileValue(profile.current_company, header.current_company)) {
        warnings.push("current company does not match profile header");
    }

    if (!profile.location) {
        warnings.push("location is empty");
    }

    if (!profile.experience.length) {
        warnings.push("experience is empty");
    } else if (profile.experience[0]) {
        if (
            !sameProfileValue(profile.experience[0].company, header.current_company) ||
            !sameProfileValue(profile.experience[0].title, header.position || header.headline)
        ) {
            warnings.push("first experience does not match profile header");
        }
    }

    const currentExperience = profile.experience.find(item =>
        item.duration?.currently_working === true &&
        sameProfileValue(item.company, header.current_company) &&
        sameProfileValue(item.title, header.position || header.headline)
    );

    if (!currentExperience) {
        warnings.push("current experience matching header was not found");
    }

    for (const item of profile.experience) {
        const duration = item.duration || {};

        if (duration.currently_working && !duration.start) {
            warnings.push(`current experience duration start is empty: ${item.title} at ${item.company}`);
        }
    }

    if (duplicateEducation.size) {
        warnings.push("duplicate education entries detected");
    }

    if (fakeSkills.length) {
        warnings.push("LinkedIn UI labels detected in skills");
    }

    if (!profile.skills.length) {
        warnings.push("skills are empty");
    }

    debugLog("profile-validation", "profile extraction validation result", {
        profile: profile.name || profile.linkedin_url,
        valid: warnings.length === 0,
        warnings
    });

    return warnings;
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
    await pause(page, 2500, 5000);
    const renderState = await humanReadProfile(page);
    const settledState = await finishProfileRendering(page, renderState);

    const currentUrl = page.url();

    if (isUnexpectedLinkedInUrl(currentUrl)) {
        throw new Error("Profile unavailable or LinkedIn session needs attention.");
    }

    const [
        header,
        about,
        initialExperience,
        initialEducation,
        initialSkills
    ] = await Promise.all([
        extractHeader(page),
        extractAbout(page),
        extractExperienceSection(page),
        extractEducation(page),
        extractSkills(page)
    ]);
    const retriedSections = await retryEmptySections(page, {
        experience: initialExperience,
        education: initialEducation,
        skills: initialSkills
    }, settledState);
    const fullExperience = await extractExperienceSection(page, {
        includeDetails: true,
        initialExperience: retriedSections.experience
    });
    const experience = normalizeExperienceDurations(ensureCurrentExperienceMatchesHeader(
        fullExperience,
        header
    ));
    const education = retriedSections.education;
    const skills = retriedSections.skills;

    const currentCompany = header.current_company;
    const position = header.position || header.headline;

    const profile = {
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
        skills
    };

    validateProfileExtraction(profile, header);

    return profile;
}

async function findAndOpenProfile(page, mutualProfile, searchState = {}) {
    const expectedUrl = normalizeProfileUrl(mutualProfile.linkedin_url);
    let lastError;
    const randomizedStrategy = chooseSearchStrategy(
        mutualProfile.name,
        HUMAN_BEHAVIOR_CONFIG,
        {
            avoidType: searchState.previousStrategyType
        }
    );

    searchState.previousStrategyType = randomizedStrategy.type;

    for (let attempt = 1; attempt <= 2; attempt++) {
        const strategy = attempt === 1
            ? randomizedStrategy
            : fullNameSearchStrategy(mutualProfile.name);

        try {
            if (attempt === 2) {
                console.log("Retrying with Full name...");
            }

            const searchResult = await runProfileSearch(page, mutualProfile, strategy);
            const match = await findBestVerifiedSuggestion(
                page,
                searchResult.suggestions,
                mutualProfile
            );

            if (match && match.verification.verified) {
                console.log("Profile verified.");
                await openVerifiedProfile(page, match.suggestion, expectedUrl);
                return;
            }

            console.log("Verification failed.");
            throw new Error(
                'Could not find "' +
                mutualProfile.name +
                '" in search suggestions above the verification threshold.'
            );
        } catch (err) {
            lastError = err;

            if (attempt >= 2) {
                break;
            }

            console.log("Retry: search attempt failed. Returning to LinkedIn Home:", err.message);
            await openLinkedInHome(page);
            await pause(page, 450, 900);
        }
    }

    console.log("Search suggestions failed. Trying direct profile URL fallback...");
    await openProfileDirectly(page, expectedUrl);
    console.log("Direct profile URL fallback succeeded.");
}

async function openProfileDirectly(page, expectedUrl) {
    if (!expectedUrl) {
        throw new Error("Direct profile fallback unavailable: expected URL is missing.");
    }

    await page.goto(expectedUrl, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUTS.pageLoadMs
    });

    await page.waitForURL(url => {
        return normalizeProfileUrl(url.href) === expectedUrl ||
            isUnexpectedLinkedInUrl(url.href);
    }, {
        timeout: TIMEOUTS.navigationMs
    }).catch(() => {});

    if (isUnexpectedLinkedInUrl(page.url())) {
        throw new Error("LinkedIn redirected unexpectedly during direct profile fallback.");
    }

    const openedUrl = normalizeProfileUrl(page.url());

    if (openedUrl !== expectedUrl) {
        throw new Error(
            "Direct profile fallback opened the wrong profile. Expected " +
            expectedUrl +
            " but opened " +
            (openedUrl || page.url())
        );
    }

    await waitForProfileContent(page);
}

function profileMatchesTarget(profile, target) {

    const profileCompany = normalizeCompanyName(
        profile.current_company
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

    return Boolean(sameCompany);
}

async function browseHomeFeed(page, minDurationMs, maxDurationMs, label, options = {}) {
    console.log(label);
    await performHumanBrowsingSession(page, createHomeActivityHelpers(), {
        ...HUMAN_BEHAVIOR_CONFIG,
        homeScrollDurationMs: randomInt(minDurationMs, maxDurationMs),
        allowPostEngagement: options.allowPostEngagement ?? true,
        allowLikes: options.allowLikes ?? true,
        allowComments: options.allowComments ?? true,
        allowInlineFeedCommenting: options.allowInlineFeedCommenting ?? true
    });
}

function createHomeActivityHelpers() {
    return {
        openLinkedInHome,
        scrollPage: scrollProfile,
        scrollMinPx: HUMAN_READING.scrollMinPx,
        scrollMaxPx: HUMAN_READING.scrollMaxPx
    };
}

async function browseHomeFeedBeforeClose(page) {
    await browseHomeFeed(
        page,
        5000,
        8000,
        "Browsing home feed before closing...",
        {
            allowPostEngagement: false,
            allowLikes: false,
            allowComments: false,
            allowInlineFeedCommenting: false
        }
    );
}

async function takeSessionBreak(page) {
    await browseHomeFeed(
        page,
        HUMAN_BEHAVIOR_CONFIG.minHomeBreakDurationMs,
        HUMAN_BEHAVIOR_CONFIG.maxHomeBreakDurationMs,
        "Taking human browsing break...",
        {
            allowPostEngagement: true,
            allowLikes: true,
            allowComments: true,
            allowInlineFeedCommenting: true
        }
    );
}

async function resumeScraping(page) {
    console.log("Resuming scraping...");
    console.log("Returning to search workflow without refreshing the page...");
    await pause(page, 5000, 15000);
    await moveMouseSlightly(page);
    await scrollProfile(page, randomInt(-160, 220)).catch(() => {});
    await pause(page, 700, 1800);
    console.log("Resume browsing complete. Ready to search next mutual.");
}

async function performInitialHomeBrowsing(page) {
    console.log("Starting initial home browsing...");
    await performInitialHomeFeedCommentSession(page, createHomeActivityHelpers(), {
        ...HUMAN_BEHAVIOR_CONFIG,
        homeScrollDurationMs: HUMAN_BEHAVIOR_CONFIG.initialHomeBrowsingDurationMs
    });
}

function scheduleNextSessionBreak() {
    const breakIntervals = [1, 3, 5, 7, 10, 12, 15, 18];
    const configuredMin = HUMAN_BEHAVIOR_CONFIG.minProfilesBeforeBreak;
    const configuredMax = HUMAN_BEHAVIOR_CONFIG.maxProfilesBeforeBreak;
    const candidates = breakIntervals.filter(value =>
        value >= configuredMin && value <= configuredMax
    );
    const nextBreak = candidates.length
        ? candidates[randomInt(0, candidates.length - 1)]
        : randomInt(configuredMin, configuredMax);

    console.log("Next human break after", nextBreak, "profiles.");
    return nextBreak;
}

function logProgress(index, total, profile) {
    console.log("");
    console.log("Profile started:", index + "/" + total, profile.name);
}

function logExtractedProfile(profile) {
    console.log("Scraped profile.");
    console.log("Extraction complete:", profile.name || profile.linkedin_url);
}

function logProfileTiming(profileMs, profileTimings, remainingProfiles) {
    const averageMs = averageProfileMs(profileTimings);

    console.log("Profile time:", formatMilliseconds(profileMs));
    console.log("Average profile time:", formatMilliseconds(averageMs));
    console.log("Estimated remaining:", formatMilliseconds(averageMs * remainingProfiles));
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
    let nextSessionBreak = Number.POSITIVE_INFINITY;
    let shuttingDown = false;
    let completedNormally = false;
    const profileTimings = [];
    const searchState = {
        previousStrategyType: null
    };

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
        console.log(
            "Human activity:",
            HUMAN_BEHAVIOR_CONFIG.enableHumanActivity ? "enabled" : "disabled"
        );

        if (!mutualProfiles.length) {
            console.log("No mutual profiles to scrape. Saving empty results and completing.");
            await saveResults(results);
            return;
        }

        if (HUMAN_BEHAVIOR_CONFIG.enableHumanActivity) {
            nextSessionBreak = scheduleNextSessionBreak();
        }

        await saveResults(results);

        session = await startBrowser();
        browser = session.browser;

        const gracefulShutdown = async (reason, exitCode) => {
            if (shuttingDown || completedNormally) {
                return;
            }

            shuttingDown = true;
            console.log("");
            console.log(reason);
            console.log("Saving progress...");

            try {
                await saveResults(results);
                console.log("Progress saved.");
            } catch (err) {
                console.error("Save failed during shutdown:", err.message);
            }

            if (browser) {
                await browser.close().catch(() => {});
            }

            process.exit(exitCode);
        };

        const requestShutdown = (reason, exitCode = 1) => {
            gracefulShutdown(reason, exitCode).catch(err => {
                console.error("Shutdown failed:", err.message);
                process.exit(exitCode);
            });
        };

        process.once("SIGINT", () => requestShutdown("SIGINT received.", 130));
        process.once("SIGTERM", () => requestShutdown("SIGTERM received.", 143));
        browser.on("disconnected", () => requestShutdown("Browser disconnected.", 1));
        session.context.on("close", () => requestShutdown("Browser context closed.", 1));
        session.page.on("close", () => requestShutdown("Page closed.", 1));

        await openLinkedInHome(session.page);

        if (
            HUMAN_BEHAVIOR_CONFIG.enableHumanActivity &&
            HUMAN_BEHAVIOR_CONFIG.enableInitialHomeBrowsing
        ) {
            await performInitialHomeBrowsing(session.page);
        }

        for (const [index, mutualProfile] of mutualProfiles.entries()) {
            if (shuttingDown) {
                break;
            }

            const normalizedUrl = normalizeProfileUrl(mutualProfile.linkedin_url);

            if (scrapedUrls.has(normalizedUrl)) {
                console.log("Warning: skipping already scraped:", mutualProfile.name);
                continue;
            }

            logProgress(index + 1, mutualProfiles.length, mutualProfile);
            const profileStartedAt = Date.now();

            try {
                const page = await ensureLivePage(session);

                await findAndOpenProfile(page, mutualProfile, searchState);

                const profile = await scrapeProfile(page);

                if (normalizeProfileUrl(profile.linkedin_url) !== normalizedUrl) {
                    throw new Error("Scraped profile URL did not match the requested profile.");
                }

                processedSinceBreak += 1;

                const shouldTakeSessionBreak =
                    HUMAN_BEHAVIOR_CONFIG.enableHumanActivity &&
                    processedSinceBreak >= nextSessionBreak &&
                    index < mutualProfiles.length - 1;

                results.push(profile);
                scrapedUrls.add(normalizedUrl);
                scrapedCount += 1;
                const profileMs = Date.now() - profileStartedAt;
                profileTimings.push(profileMs);

                logExtractedProfile(profile);
                await saveResults(results);
                console.log("Saved:", "data/mutual-details.json");
                logProfileTiming(
                    profileMs,
                    profileTimings,
                    mutualProfiles.length - index - 1
                );

                if (!profileMatchesTarget(profile, target)) {
                    console.log("Warning: no company match.");

                    if (shouldTakeSessionBreak) {
                        await takeSessionBreak(page);
                        await resumeScraping(page);
                        processedSinceBreak = 0;
                        nextSessionBreak = scheduleNextSessionBreak();
                    } else {
                        await waitBetweenProfiles(page);
                    }

                    continue;
                }

                if (shouldTakeSessionBreak) {
                    await takeSessionBreak(page);
                    await resumeScraping(page);
                    processedSinceBreak = 0;
                    nextSessionBreak = scheduleNextSessionBreak();
                } else {
                    await waitBetweenProfiles(page);
                }
            } catch (err) {
                failedCount += 1;
                console.error("Profile failed:", err.message);

                if (shuttingDown) {
                    break;
                }

                try {
                    await openLinkedInHome(await ensureLivePage(session));
                } catch (recoveryErr) {
                    console.error("Recovery failed:", recoveryErr.message);
                }
            }
        }

        completedNormally = true;

        if (session && session.page && !session.page.isClosed()) {
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
    extractLocation,
    extractAbout,
    extractConnectionStatus,
    scrapeProfile,
    saveResults,
    loadMutuals,
    loadExistingResults,
    openLinkedInHome,
    searchProfile,
    runProfileSearch,
    openVerifiedProfile,
    humanReadProfile,
    waitBetweenProfiles,
    browseHomeFeedBeforeClose,
    ensureCurrentExperienceMatchesHeader,
    normalizeExperienceDurations,
    validateProfileExtraction,
    main
};
