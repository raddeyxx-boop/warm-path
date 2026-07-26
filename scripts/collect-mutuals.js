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
    resultCards: [
        'main [data-view-name="search-entity-result-universal-template"]',
        'main li:has(a[href*="/in/"])',
        'main .entity-result:has(a[href*="/in/"])',
        'main a[href*="/in/"]'
    ].join(", "),
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
    maxScrollRounds: 40,
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

    const targetUrl = normalizeLinkedInProfileUrl(target.linkedin_url || target.url);

    if (!target.name) {
        throw new Error(
            "data/target.json must include a target name."
        );
    }

    return {
        name: target.name,
        company: target.company || target.current_company || target.company_filter || "",
        school: target.school_filter || "",
        url: targetUrl
    };
}



async function collectProfiles(page, sourcePage = 1) {

    await page.locator(SELECTORS.resultsContainer).first().waitFor({
        state: "visible",
        timeout: TIMEOUTS.resultsContainerMs
    });

    const sourceSearchUrl = page.url();
    const cards = page.locator(SELECTORS.resultCards);
    const profiles = await cards.evaluateAll((cardElements, metadata) => {

            const results = [];
            const clean = value => (value || "").replace(/\s+/g, " ").trim();
            const canonicalUrl = value => {
                try {
                    const url = new URL(value, "https://www.linkedin.com");
                    if (url.hostname.replace(/^www\./, "") !== "linkedin.com") return "";
                    const match = url.pathname.match(/^\/in\/[^/]+/i);
                    return match ? `https://www.linkedin.com${match[0]}/` : "";
                } catch (error) {
                    return "";
                }
            };
            const cleanName = value => clean(value)
                .replace(/\bis open to work\b/ig, " ")
                .replace(/\s*•\s*(?:1st|2nd|3rd\+?)\b.*$/i, "")
                .replace(/\b(?:connect|message|follow|pending)\b.*$/ig, "")
                .replace(/\bmutual connection\b.*$/ig, "")
                .replace(/\b\d[\d,]*\s+followers?\b.*$/ig, "")
                .replace(/\s+/g, " ")
                .trim();
            const invalidName = value => !value || value.length > 120 ||
                /connect|follow|pending|mutual connection|followers?|view profile|^next$|^previous$/i.test(value);

            for (const [index, card] of cardElements.entries()) {
                const cardRoot = card.closest?.('li, [data-view-name*="search-entity-result"], .entity-result') || card;
                const links = [...cardRoot.querySelectorAll('a[href*="/in/"]')]
                    .filter(link => canonicalUrl(link.href) &&
                        !/mutual connection/i.test(link.parentElement?.innerText || ""));
                const profileLink = links
                    .map(link => ({
                        link,
                        score: (link.querySelector('[data-anonymize="person-name"], span[aria-hidden="true"]') ? 4 : 0) +
                            (link.closest('[data-anonymize="person-name"], .entity-result__title-text') ? 3 : 0) +
                            (link.textContent.trim().length < 120 ? 1 : 0)
                    }))
                    .sort((left, right) => right.score - left.score)[0]?.link;
                const rawHref = profileLink?.href || "";
                const linkedinUrl = canonicalUrl(rawHref);
                const nameElement = cardRoot.querySelector(
                    '[data-anonymize="person-name"], ' +
                    '.entity-result__title-text [aria-hidden="true"]'
                ) || profileLink?.querySelector(
                    '[data-anonymize="person-name"], span[aria-hidden="true"]'
                );
                const rawName = clean(
                    nameElement?.textContent ||
                    profileLink?.textContent || ""
                );
                const name = cleanName(rawName);
                const headline = clean(cardRoot.querySelector(
                    '.entity-result__primary-subtitle, [data-anonymize="headline"]'
                )?.textContent);
                const location = clean(cardRoot.querySelector(
                    '.entity-result__secondary-subtitle, [data-anonymize="location"]'
                )?.textContent);
                const accepted = Boolean(name && linkedinUrl && !invalidName(name));
                const rejectedReason = !linkedinUrl ? "missing primary profile URL" :
                    invalidName(name) ? "invalid candidate name" : "";

                results.push({
                    card_index: index + 1,
                    raw_name: rawName,
                    name,
                    raw_href: rawHref,
                    linkedin_url: linkedinUrl,
                    headline,
                    location,
                    current_company: "",
                    source_page: metadata.sourcePage,
                    source_search_url: metadata.sourceSearchUrl,
                    accepted,
                    rejected_reason: rejectedReason
                });
            }

            return results;
        }, { sourcePage, sourceSearchUrl });

    for (const card of profiles) {
        console.log("Candidate card extraction:", {
            card_index: card.card_index,
            primary_profile_url: card.linkedin_url,
            raw_name: card.raw_name,
            clean_candidate_name: card.name,
            rejected: !card.accepted,
            rejected_reason: card.rejected_reason || null
        });
    }

    const acceptedProfiles = profiles
        .filter(profile => profile.accepted)
        .map(({ card_index, raw_name, raw_href, accepted, rejected_reason, ...profile }) => profile);
    acceptedProfiles.stats = {
        cardsDetected: profiles.length,
        cardsInspected: profiles.length,
        cardsAccepted: acceptedProfiles.length,
        cardsRejected: profiles.length - acceptedProfiles.length
    };
    return acceptedProfiles;
}

async function waitForMutualResultState(page) {
    console.log("Verifying mutual result cards before collection...");
    const stateHandle = await page.waitForFunction(profileLinkSelector => {
        const visible = element => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
                style.visibility !== "hidden";
        };
        const main = document.querySelector("main");
        const mainText = (main?.innerText || "").replace(/\s+/g, " ").trim();
        const profileLinkCount = [...document.querySelectorAll(profileLinkSelector)]
            .filter(link => visible(link) && (() => {
                try {
                    return /^\/in\/[^/]+/i.test(new URL(link.href).pathname);
                } catch (error) {
                    return false;
                }
            })()).length;
        const blockingModal = [...document.querySelectorAll('[role="dialog"]')]
            .some(dialog => visible(dialog) &&
                /people filters|show results|filter results/i.test(dialog.innerText || dialog.textContent || ""));
        const loadingSpinner = [...document.querySelectorAll(
            'main [role="progressbar"], main .artdeco-loader, main [data-test-loading-spinner]'
        )].some(visible);

        if (profileLinkCount > 0 && !blockingModal && !loadingSpinner) return "results";
        if (/no results|no matching results|we didn['’]t find any|try changing|remove some of your filters/i.test(mainText)) {
            return "empty";
        }
        return false;
    }, SELECTORS.profileLinks, {
        timeout: TIMEOUTS.resultsContainerMs
    }).catch(async error => {
        const state = await page.evaluate(profileLinkSelector => {
            const main = document.querySelector("main");
            const visible = element => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
                    style.visibility !== "hidden";
            };
            return {
                url: window.location.href,
                title: document.title,
                mainVisible: Boolean(main && main.getBoundingClientRect().height > 0),
                headings: [...document.querySelectorAll("main h1, main h2, main h3, main [role='heading']")]
                    .filter(visible)
                    .map(heading => (heading.innerText || heading.textContent || "").replace(/\s+/g, " ").trim())
                    .filter(Boolean)
                    .slice(0, 12),
                mainHtml: (main?.innerHTML || "").replace(/\s+/g, " ").trim().slice(0, 1500),
                profileLinkCount: document.querySelectorAll(profileLinkSelector).length,
                visibleProfileLinkCount: [...document.querySelectorAll(profileLinkSelector)].filter(visible).length,
                visibleFilterDialogs: [...document.querySelectorAll('[role="dialog"]')]
                    .filter(dialog => visible(dialog) &&
                        /people filters|show results|filter results/i.test(dialog.innerText || dialog.textContent || ""))
                    .length,
                visibleSpinners: [...document.querySelectorAll(
                    'main [role="progressbar"], main .artdeco-loader, main [data-test-loading-spinner]'
                )].filter(visible).length
            };
        }, SELECTORS.profileLinks).catch(() => ({ url: page.url() }));

        console.warn("Mutual result readiness timed out.", {
            reason: error.message,
            ...state
        });

        throw new Error(
            `Filtered people-search page did not become ready: ${state.visibleProfileLinkCount || 0} ` +
            `visible profile links, ${state.visibleFilterDialogs || 0} filter dialogs, ` +
            `${state.visibleSpinners || 0} loading spinners. Current URL: ${state.url || page.url()}`
        );
    });
    const state = await stateHandle.jsonValue();

    if (state === "empty") {
        console.log("No mutual connections matched the selected filters.");
    } else {
        const visibleProfiles = await page.locator(SELECTORS.profileLinks).evaluateAll(links =>
            links.filter(link => {
                const rect = link.getBoundingClientRect();
                const style = window.getComputedStyle(link);
                return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
                    style.visibility !== "hidden";
            }).length
        );
        console.log("Filtered results page loaded.");
        console.log("Current URL:", page.url());
        console.log("Results container found.");
        console.log("Results page verified.");
        console.log("Visible profiles:", visibleProfiles);
    }

    return state;
}

async function resolveResultsScrollTarget(page) {
    const target = await page.evaluate(profileLinkSelector => {
        document.querySelectorAll('[data-warm-path-results-scroll-target="true"]')
            .forEach(element => element.removeAttribute("data-warm-path-results-scroll-target"));

        const profileLinks = [...document.querySelectorAll(profileLinkSelector)];
        const main = document.querySelector("main, [role='main']");
        const candidates = [...document.querySelectorAll("main, [role='main'], main *")]
            .filter(element => {
                const style = window.getComputedStyle(element);
                return /^(auto|scroll)$/.test(style.overflowY) &&
                    element.scrollHeight > element.clientHeight + 50 &&
                    profileLinks.some(link => element.contains(link));
            })
            .sort((left, right) =>
                (right.scrollHeight - right.clientHeight) -
                (left.scrollHeight - left.clientHeight)
            );
        const nested = candidates[0] || null;
        const documentElement = document.scrollingElement || document.documentElement;
        const documentScrollable = documentElement.scrollHeight > window.innerHeight + 50;

        if (nested) {
            nested.setAttribute("data-warm-path-results-scroll-target", "true");
            return {
                kind: "element",
                selector: '[data-warm-path-results-scroll-target="true"]',
                tag: nested.tagName,
                id: nested.id || "",
                className: typeof nested.className === "string" ? nested.className.slice(0, 160) : "",
                scrollTop: nested.scrollTop,
                clientHeight: nested.clientHeight,
                scrollHeight: nested.scrollHeight,
                overflowY: window.getComputedStyle(nested).overflowY
            };
        }

        return {
            kind: "window",
            selector: null,
            tag: main?.tagName || "DOCUMENT",
            id: main?.id || "",
            className: typeof main?.className === "string" ? main.className.slice(0, 160) : "",
            scrollTop: documentElement.scrollTop,
            clientHeight: window.innerHeight,
            scrollHeight: documentElement.scrollHeight,
            overflowY: window.getComputedStyle(documentElement).overflowY
        };
    }, SELECTORS.profileLinks);

    console.log("Mutual results scroll target:", target);
    return target;
}

async function readResultsScrollMetrics(page, target) {
    return await page.evaluate(scrollTarget => {
        const element = scrollTarget.kind === "element"
            ? document.querySelector(scrollTarget.selector)
            : (document.scrollingElement || document.documentElement);

        if (!element) {
            return { missing: true, scrollTop: 0, clientHeight: 0, scrollHeight: 0 };
        }

        return {
            missing: false,
            scrollTop: element.scrollTop,
            clientHeight: scrollTarget.kind === "window" ? window.innerHeight : element.clientHeight,
            scrollHeight: element.scrollHeight
        };
    }, target);
}

async function scrollResultsTarget(page, target, distance) {
    await page.evaluate(({ scrollTarget, amount }) => {
        if (scrollTarget.kind === "element") {
            const element = document.querySelector(scrollTarget.selector);
            if (!element) throw new Error("Resolved mutual-results scroll target disappeared.");
            element.scrollBy({ top: amount, behavior: "smooth" });
            return;
        }

        window.scrollBy({ top: amount, behavior: "smooth" });
    }, { scrollTarget: target, amount: distance });
}

async function waitForVisibleResultsToSettle(page, sourcePage) {
    console.log(`[MUTUAL RESULTS] Waiting for visible results on page ${sourcePage}`);
    let previousCount = -1;
    let stableCount = 0;

    for (let attempt = 1; attempt <= 12 && stableCount < 2; attempt += 1) {
        const state = await page.evaluate(profileLinkSelector => {
            const visible = element => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
                    style.visibility !== "hidden";
            };
            return {
                count: [...document.querySelectorAll(profileLinkSelector)].filter(visible).length,
                loading: [...document.querySelectorAll(
                    'main [role="progressbar"], main .artdeco-loader, main [data-test-loading-spinner]'
                )].some(visible)
            };
        }, SELECTORS.profileLinks);

        stableCount = !state.loading && state.count > 0 && state.count === previousCount
            ? stableCount + 1
            : 0;
        previousCount = state.count;
        if (stableCount < 2) await pause(page, 500, 1200);
    }

    if (stableCount < 2) {
        throw new Error(`Visible mutual results on page ${sourcePage} did not settle.`);
    }
    console.log(`[MUTUAL RESULTS] Visible results ready on page ${sourcePage}: ${previousCount}`);
}

async function returnResultsToTopNaturally(page, target, sourcePage) {
    console.log(`[MUTUAL RESULTS] Returning page ${sourcePage} to the top`);

    for (let step = 1; step <= 30; step += 1) {
        const metrics = await readResultsScrollMetrics(page, target);
        if (metrics.missing) throw new Error("Mutual-results scroll target disappeared during top reset.");
        if (metrics.scrollTop <= 20) {
            console.log(`[MUTUAL RESULTS] Page ${sourcePage} top verified`);
            await pause(page, 800, 1800);
            return;
        }
        await moveMouseNaturally(page);
        await scrollResultsTarget(page, target, -Math.min(metrics.scrollTop, randomInt(260, 680)));
        await pause(page, 350, 900);
    }

    const finalMetrics = await readResultsScrollMetrics(page, target);
    if (finalMetrics.scrollTop > 20) {
        throw new Error(`Mutual results page ${sourcePage} did not return to the top.`);
    }
}

async function scrollToBottom(page, sourcePage = 1) {
    let stableRounds = 0;
    let reachedStableBottom = false;
    const collected = new Map();
    const stats = {
        cardsDetected: 0,
        cardsInspected: 0,
        cardsAccepted: 0,
        cardsRejected: 0,
        duplicatesSkipped: 0
    };

    const collectVisibleCards = async () => {
        const visibleProfiles = await collectProfiles(page, sourcePage);
        Object.keys(stats).filter(key => key !== "duplicatesSkipped").forEach(key => {
            stats[key] += visibleProfiles.stats?.[key] || 0;
        });
        for (const profile of visibleProfiles) {
            if (collected.has(profile.linkedin_url)) {
                stats.duplicatesSkipped += 1;
            } else {
                collected.set(profile.linkedin_url, profile);
            }
        }
        return visibleProfiles.length;
    };

    await waitForVisibleResultsToSettle(page, sourcePage);
    console.log(`[MUTUAL RESULTS] Starting human browsing on page ${sourcePage}`);
    await moveMouseNaturally(page);
    await pause(page, 1200, 2400);
    const scrollTarget = await resolveResultsScrollTarget(page);
    await returnResultsToTopNaturally(page, scrollTarget, sourcePage);
    console.log(`[MUTUAL RESULTS] Starting natural downward scroll on page ${sourcePage}`);
    console.log("Collecting first batch...");
    const firstBatchCount = await collectVisibleCards();
    console.log("Profiles detected:", firstBatchCount);
    for (let round = 1; round <= LIMITS.maxScrollRounds; round++) {
        const before = await readResultsScrollMetrics(page, scrollTarget);
        if (before.missing) {
            throw new Error("Mutual-results scroll target is no longer available.");
        }
        const previousUniqueCount = collected.size;
        const distance = Math.max(160, Math.round(
            before.clientHeight * (randomInt(60, 80) / 100)
        ));

        await moveMouseNaturally(page);
        await scrollResultsTarget(page, scrollTarget, distance);
        await pause(page, 1200, 2800);

        if (Math.random() < 0.16) {
            console.log("Reading mutual result cards...");
            await pause(page, 3000, 7000);
        }

        if (Math.random() < 0.18) {
            await scrollResultsTarget(page, scrollTarget, -randomInt(60, 180)).catch(() => {});
            await pause(page, 900, 1800);
        }
        await collectVisibleCards();
        const visibleCardCount = await page
            .locator(SELECTORS.profileLinks)
            .count()
            .catch(() => 0);
        const after = await readResultsScrollMetrics(page, scrollTarget);
        const atBottom = after.scrollTop + after.clientHeight >= after.scrollHeight - 30;
        const unchanged = after.scrollTop === before.scrollTop &&
            after.scrollHeight === before.scrollHeight &&
            collected.size === previousUniqueCount;

        stableRounds = atBottom && unchanged ? stableRounds + 1 : 0;
        console.log("Profiles loaded:", visibleCardCount);
        console.log("Mutual results bottom check:", {
            pageNumber: sourcePage,
            scrollTop: after.scrollTop,
            clientHeight: after.clientHeight,
            scrollHeight: after.scrollHeight,
            atBottom,
            visibleCards: visibleCardCount,
            uniqueCandidates: collected.size,
            stableIterations: stableRounds
        });

        if (stableRounds >= LIMITS.stableScrollRounds) {
            reachedStableBottom = true;
            console.log(`[MUTUAL RESULTS] Real bottom confirmed on page ${sourcePage}`);
            break;
        }
    }

    if (!reachedStableBottom) {
        throw new Error(
            `Mutual results did not reach a stable bottom after ${LIMITS.maxScrollRounds} controlled scrolls.`
        );
    }

    await collectVisibleCards();
    await pause(page, 1600, 3600);

    console.log("Finished scrolling.");
    console.log("Page collection summary:", {
        ...stats,
        uniqueTotal: collected.size
    });
    return [...collected.values()];
}

async function getCurrentPageNumber(page) {
    const current = page.locator([
        'nav[aria-label*="pagination" i] [aria-current="page"]',
        'nav[aria-label*="pagination" i] [aria-current="true"]',
        '.artdeco-pagination [aria-current="page"]',
        '.artdeco-pagination__indicator--number.active',
        '.artdeco-pagination__indicator--number.selected',
        'button[aria-pressed="true"][aria-label*="page" i]'
    ].join(", "));
    const count = await current.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
        const value = await current.nth(index).evaluate(element =>
            (element.innerText || element.textContent || element.getAttribute("aria-label") || "")
                .replace(/\s+/g, " ").trim()
        ).catch(() => "");
        const match = value.match(/\d+/);
        if (match) return match[0];
    }
    return new URL(page.url()).searchParams.get("page") || "unknown";
}

async function captureResultsPageState(page) {
    const urls = await page.locator(SELECTORS.profileLinks).evaluateAll(links => {
        const unique = new Set();
        for (const link of links) {
            try {
                const url = new URL(link.href, "https://www.linkedin.com");
                const match = url.pathname.match(/^\/in\/[^/]+/i);
                if (match) unique.add(`https://www.linkedin.com${match[0]}/`);
                if (unique.size >= 3) break;
            } catch (error) {}
        }
        return [...unique];
    }).catch(() => []);
    const url = page.url();
    const pageNumber = await getCurrentPageNumber(page);
    let normalizedUrl = url;
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        normalizedUrl = parsed.toString();
    } catch (error) {}

    return {
        url,
        pageNumber,
        firstCandidateUrl: urls[0] || "",
        firstThreeCandidateUrls: urls,
        fingerprint: `${pageNumber}|${urls.join("|")}|${normalizedUrl}`
    };
}

async function findLinkedInNextButton(page) {
    const diagnostics = await page.evaluate(() => {
        document.querySelectorAll('[data-warm-path-next-control="true"]')
            .forEach(element => element.removeAttribute("data-warm-path-next-control"));
        const visible = (element, rect, style) => rect.width > 0 && rect.height > 0 &&
            style.display !== "none" && style.visibility !== "hidden";
        const allNextElements = [
            ...document.querySelectorAll(
                'main button, main a, main [role="button"], main [role="link"]'
            )
        ].filter(element => {
            const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
            const ariaLabel = element.getAttribute("aria-label") || "";
            return /^next$/i.test(text) || /^next page$/i.test(text) ||
                /\bnext(?:\s+page)?\b/i.test(ariaLabel);
        });
        const allNextDiagnostics = allNextElements.map((element, index) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return {
                index,
                tagName: element.tagName,
                text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
                ariaLabel: element.getAttribute("aria-label") || "",
                role: element.getAttribute("role") || "",
                href: element.getAttribute("href") || "",
                disabled: Boolean(element.disabled),
                ariaDisabled: element.getAttribute("aria-disabled"),
                visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
                parentTag: element.parentElement?.tagName || "",
                parentRole: element.parentElement?.getAttribute("role") || "",
                parentAriaLabel: element.parentElement?.getAttribute("aria-label") || "",
                parentClass: typeof element.parentElement?.className === "string" ? element.parentElement.className.slice(0, 200) : ""
            };
        });

        const paginationRegions = [...document.querySelectorAll(
            'nav[aria-label*="pagination" i], nav[aria-label*="page" i], ' +
            '[role="navigation"][aria-label*="pagination" i], .artdeco-pagination, ' +
            'main ul:has([aria-current="page"]), main ol:has([aria-current="page"])'
        )].filter(region => {
            const text = (region.innerText || region.textContent || "").replace(/\s+/g, " ");
            return /\b(?:next|previous|page)\b/i.test(text);
        });
        const elements = paginationRegions.flatMap(region =>
            [...region.querySelectorAll('button, a, [role="button"], [role="link"]')]
        );
        const candidates = elements.map((element, index) => {
            const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
            const ariaLabel = element.getAttribute("aria-label") || "";
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const insidePagination = paginationRegions.some(region => region.contains(element));
            const isNext = /\bnext(?:\s+page)?\b/i.test(`${text} ${ariaLabel}`) &&
                !/\bprevious\b/i.test(`${text} ${ariaLabel}`);
            return {
                index,
                tagName: element.tagName,
                text: text.slice(0, 100),
                ariaLabel: ariaLabel.slice(0, 100),
                role: element.getAttribute("role") || "",
                disabled: Boolean(element.disabled),
                ariaDisabled: element.getAttribute("aria-disabled"),
                visible: visible(element, rect, style),
                boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                insidePagination,
                element
            };
        }).filter(item => /\bnext(?:\s+page)?\b/i.test(`${item.text} ${item.ariaLabel}`) &&
            !/\bprevious\b/i.test(`${item.text} ${item.ariaLabel}`));
        let selected = candidates
            .filter(item => item.insidePagination && item.visible && !item.disabled && item.ariaDisabled !== "true")
            .sort((left, right) => Number(right.boundingBox.y) - Number(left.boundingBox.y))[0] || null;
        let selectionSource = selected ? "recognized pagination region" : null;

        if (!selected) {
            const resultsArea = document.querySelector('[data-warm-path-results-scroll-target="true"]') ||
                document.querySelector("main");
            const fallbackButtons = resultsArea
                ? [...resultsArea.querySelectorAll("button")].filter(element => {
                    const normalizedText = (element.innerText || element.textContent || "")
                        .replace(/\s+/g, " ").trim().toLowerCase();
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    const visibleButton = rect.width > 0 && rect.height > 0 &&
                        style.display !== "none" && style.visibility !== "hidden";
                    const insideProfileCard = Boolean(element.closest(
                        '[data-view-name*="search-entity-result"], li:has(a[href*="/in/"]), .entity-result'
                    ));
                    return normalizedText === "next" && visibleButton &&
                        element.tagName === "BUTTON" && !element.disabled &&
                        element.getAttribute("aria-disabled") !== "true" &&
                        !element.closest("a") && !insideProfileCard &&
                        !element.getAttribute("href");
                })
                : [];
            const fallbackElement = fallbackButtons[fallbackButtons.length - 1];
            if (fallbackElement) {
                const rect = fallbackElement.getBoundingClientRect();
                selected = {
                    index: allNextElements.indexOf(fallbackElement),
                    tagName: "BUTTON",
                    text: "Next",
                    ariaLabel: fallbackElement.getAttribute("aria-label") || "",
                    role: fallbackElement.getAttribute("role") || "",
                    disabled: false,
                    ariaDisabled: fallbackElement.getAttribute("aria-disabled"),
                    visible: true,
                    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    insidePagination: false,
                    element: fallbackElement
                };
                selectionSource = "exact Next button inside mutual results fallback";
            }
        }
        if (selected) selected.element.setAttribute("data-warm-path-next-control", "true");
       return {
    allNextDiagnostics,
    paginationVisible: paginationRegions.some(region => {
                const rect = region.getBoundingClientRect();
                const style = window.getComputedStyle(region);
                return visible(region, rect, style);
            }),
            scrollY: window.scrollY,
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
            candidates: candidates.map(({ element, ...item }) => item),
            selected: selected ? (({ element, ...item }) => ({ ...item, selectionSource }))(selected) : null
        };
    });
    const locator = page.locator('[data-warm-path-next-control="true"]');
    const found = Boolean(diagnostics.selected) && await locator.count().catch(() => 0) === 1;
    const result = {
        found,
        visible: found && diagnostics.selected.visible,
        enabled: found && !diagnostics.selected.disabled && diagnostics.selected.ariaDisabled !== "true",
        paginationVisible: diagnostics.paginationVisible,
        locator,
        selectorStrategy: diagnostics.selected?.selectionSource || "none",
        ...diagnostics.selected
    };
console.log(
    "Pagination diagnostics",
    JSON.stringify({
        currentUrl: page.url(),
        allNextElements: diagnostics.allNextDiagnostics,
        scrollY: diagnostics.scrollY,
        documentHeight: diagnostics.documentHeight,
        viewportHeight: diagnostics.viewportHeight,
        paginationVisible: diagnostics.paginationVisible,
        nextCandidates: diagnostics.candidates,
        selected: diagnostics.selected
    }, null, 2)
);
    console.log("NEXT CONTROL", { ...result, locator: undefined });
    return result;
}

async function inspectNextClickTarget(locator) {
    return await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            hitTag: hit?.tagName || null,
            hitText: hit?.textContent?.trim().slice(0, 100) || null,
            hitClass: typeof hit?.className === "string" ? hit.className.slice(0, 200) : null,
            targetContainsHit: Boolean(hit && (element.contains(hit) || hit.contains(element)))
        };
    });
}

async function waitForLinkedInResultsPageChange(page, previousState) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < TIMEOUTS.nextPageMs) {
        if (page.isClosed()) throw new Error("Page closed while waiting for LinkedIn pagination.");
        if (/linkedin\.com\/in\/[^/?#]+/i.test(page.url())) {
            throw new Error(`Invalid pagination transition opened a profile page: ${page.url()}`);
        }
        const currentState = await captureResultsPageState(page);
        const reason = {
            pageNumberChanged: currentState.pageNumber !== previousState.pageNumber,
            firstCandidateChanged: currentState.firstCandidateUrl !== previousState.firstCandidateUrl,
            fingerprintChanged: currentState.fingerprint !== previousState.fingerprint,
            urlChanged: currentState.url !== previousState.url
        };
        if (Object.values(reason).some(Boolean)) {
            await waitForMutualResultState(page);
            return { changed: true, currentState, reason };
        }
        await page.waitForTimeout(300);
    }
    return { changed: false };
}

async function saveNextFailureDiagnostics(page, details) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotDir = path.join(DATA_DIR, "..", "debug", "screenshots");
    const htmlDir = path.join(DATA_DIR, "..", "debug", "html");
    const logDir = path.join(DATA_DIR, "..", "debug", "logs");
    await Promise.all([screenshotDir, htmlDir, logDir].map(directory => fs.mkdir(directory, { recursive: true })));
    const baseName = `next-click-failure-${timestamp}`;
    await page.screenshot({ path: path.join(screenshotDir, `${baseName}.png`), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(htmlDir, `${baseName}.html`), await page.content(), "utf8").catch(() => {});
    await writeJsonAtomic(path.join(logDir, `${baseName}.json`), details).catch(() => {});
}

async function goToNextPage(page, previousState = null) {
    const previous = previousState || await captureResultsPageState(page);
    let next = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        next = await findLinkedInNextButton(page);
        console.log("Pagination lookup attempt", { attempt, found: next.found, visible: next.visible, enabled: next.enabled });
        if (next.found && next.visible && next.enabled) break;
        if (attempt === 3) break;
        const target = await resolveResultsScrollTarget(page).catch(() => null);
        if (target) {
            await page.evaluate(scrollTarget => {
                const element = scrollTarget.kind === "element"
                    ? document.querySelector(scrollTarget.selector)
                    : (document.scrollingElement || document.documentElement);
                if (element) element.scrollTop = element.scrollHeight;
            }, target).catch(() => {});
        }
        await page.waitForTimeout(700);
    }
    if (!next.found || !next.visible || !next.enabled) {
        console.log("Pagination complete", { reason: "Next is unavailable or disabled" });
        return { moved: false, reason: "no-next-page" };
    }

    console.log("[MUTUAL RESULTS] Pagination verified and Next is visible");
    await moveMouseNaturally(page);
    await pause(page, 1200, 2800);

    try {
        await next.locator.scrollIntoViewIfNeeded({ timeout: 5000 });
        let clickDiagnostics = await inspectNextClickTarget(next.locator);
        if (!clickDiagnostics.targetContainsHit) {
            await next.locator.evaluate(element => {
                element.scrollIntoView({ block: "center", inline: "nearest" });
                window.scrollBy(0, -150);
            });
            await page.waitForTimeout(250);
            clickDiagnostics = await inspectNextClickTarget(next.locator);
        }
        console.log("Next click diagnostics", clickDiagnostics);
        const box = await next.locator.boundingBox();
        const debugStepDelay = Number(process.env.PLAYWRIGHT_STEP_DELAY || 0);
        if (box && debugStepDelay > 0) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
            await page.waitForTimeout(debugStepDelay);
        }
        console.log("Moving to next page...");
        console.log("Next click attempted", {
            selectorStrategy: next.selectorStrategy,
            tagName: next.tagName,
            text: next.text,
            ariaLabel: next.ariaLabel
        });
        await next.locator.click({ timeout: 10000 });
        const change = await waitForLinkedInResultsPageChange(page, previous);
        if (!change.changed) throw new Error("Next was clicked but LinkedIn results page did not change.");
        console.log("Next results page verified", {
            previousPageNumber: previous.pageNumber,
            newPageNumber: change.currentState.pageNumber,
            previousUrl: previous.url,
            newUrl: change.currentState.url,
            previousFingerprint: previous.fingerprint,
            newFingerprint: change.currentState.fingerprint,
            reason: change.reason
        });
        console.log("Next page opened.");
        console.log("[MUTUAL RESULTS] Next results page loaded; top reset will run before browsing");
        return { moved: true, currentState: change.currentState };
    } catch (error) {
        await saveNextFailureDiagnostics(page, {
            error: error.message,
            url: page.url(),
            previousState: previous,
            selectedControl: { ...next, locator: undefined }
        });
        throw error;
    }
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
        const existing = uniqueProfiles.get(normalizedUrl);
        const nextName = (profile.name || "").trim();
        const existingName = existing?.name || "";

        uniqueProfiles.set(normalizedUrl, {
            ...existing,
            ...profile,
            name: existingName || nextName,
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
        const seenPageFingerprints = new Set();

    try {
        target = await loadTarget();

        logTarget(target);

        const initialResultState = await waitForMutualResultState(page);
        if (initialResultState === "empty") {
            await saveResults([]);
            console.log("Saved empty mutuals checkpoint: data/mutuals.json");
            return;
        }

       

for (let pageIndex = 1; pageIndex <= LIMITS.maxPages; pageIndex++) {

console.log("==============================");
console.log("Processing current page:", pageIndex);
console.log("==============================");
const profiles = await scrollToBottom(page, pageIndex);

collectedProfiles.push(...profiles);

console.log("");
console.log("Collected profiles from page:", profiles.length);
if (profiles[0]) {
    console.log("First mutual extracted:");
    console.log("Name:", profiles[0].name);
    console.log("Profile:", profiles[0].linkedin_url);
}
console.log("");

const normalizedPartial = normalizeProfiles(
    collectedProfiles,
    target.url,
    target.name
);

await saveResults(normalizedPartial);
console.log("Partial mutuals saved:", normalizedPartial.length);
console.log("Current mutual page complete", {
    pageNumber: pageIndex,
    collectedThisPage: profiles.length,
    totalUnique: normalizedPartial.length
});

    const pageState = await captureResultsPageState(page);
    if (pageState.fingerprint) seenPageFingerprints.add(pageState.fingerprint);
    const nextResult = await goToNextPage(page, pageState);

    if (!nextResult.moved) {
        reachedPageCap = false;
        console.log("Mutual pagination completed", {
            reason: nextResult.reason,
            totalUnique: normalizedPartial.length
        });
        break;
    }

    if (nextResult.currentState?.fingerprint &&
        seenPageFingerprints.has(nextResult.currentState.fingerprint)) {
        throw new Error("LinkedIn pagination repeated a previously processed results page.");
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
