const {
    loadTargetProfile
} = require("../utils/loadTargetProfile");
const { saveTargetProfile } = require("../utils/saveTargetProfile");
const { mergeTargetProfile } = require("../utils/mergeTargetProfile");
const { scrapeProfile } = require("./scrape-profile-details");

const {
    HUMAN_BEHAVIOR_CONFIG
} = require("../utils/HumanBehaviorConfig");
const {
    performInitialHomeFeedCommentSession
} = require("./HumanActivity");

const fs = require("fs");
const path = require("path");
const { resilientClick } = require("../services/playwright-actions");
const { emitProgress } = require("../utils/ProgressEvents");

const LINKEDIN_HOME_URL = "https://www.linkedin.com/feed/";
const SEARCH_INPUT_SELECTOR = [
    'input[role="combobox"][placeholder*="Search" i]',
    'input[aria-label*="Search" i]',
    'input[placeholder*="Search" i]',
    'header input[type="text"]'
].join(", ");

function cleanText(value) {
    return (value || "").toString().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
    return cleanText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeProfileUrl(value) {
    try {
        const url = new URL(value, "https://www.linkedin.com");
        const match = url.pathname.match(/^\/in\/[^/]+\/?/i);

        if (!match) {
            return "";
        }

        return "https://www.linkedin.com" + match[0].replace(/\/?$/, "/");
    } catch (err) {
        return "";
    }
}

function validateLinkedInProfileUrl(value) {
    const input = cleanText(value);
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;

    try {
        const url = new URL(withProtocol);
        const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
        const profileMatch = url.pathname.match(/^\/in\/([^/]+)\/?$/i);

        if (hostname !== "linkedin.com" || !profileMatch?.[1]) {
            throw new Error("not a LinkedIn profile URL");
        }

        return `https://www.linkedin.com/in/${profileMatch[1]}`;
    } catch (err) {
        throw new Error("LinkedIn profile URL is invalid.", { cause: err });
    }
}

function normalizeLinkedInProfilePath(value) {
    if (!value) return "";

    try {
        const parsed = new URL(value, "https://www.linkedin.com");
        const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
        return pathname.startsWith("/in/") ? pathname : "";
    } catch (err) {
        return "";
    }
}

function normalizeName(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function isUnexpectedLinkedInUrl(value) {
    return /\/login|\/checkpoint|\/uas\/login|\/404/i.test(value || "");
}

function logRecoverable(functionName, reason, recoveryAction) {
    console.log(
        `[search-pavel.js:${functionName}] ${reason}. Recovery: ${recoveryAction}.`
    );
}

function firstNonEmpty(values) {
    return values.map(cleanText).find(Boolean) || "";
}

function getTargetCompany(target = {}) {
    return firstNonEmpty([
        target.company_filter,
        target.company,
    ]);
}

function getTargetSchool(target = {}) {
    return cleanText(target.school_filter);
}

async function naturalPause(page, minMs = 300, maxMs = 800) {
    await page.waitForTimeout(randomInt(minMs, maxMs));
}

async function findVisibleLocator(locator, timeout = 1500) {
    const deadline = Date.now() + timeout;

    while (Date.now() <= deadline) {
        const count = await locator.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
            const candidate = locator.nth(index);
            if (await candidate.isVisible({ timeout: 250 }).catch(() => false)) return candidate;
        }

        await new Promise(resolve => setTimeout(resolve, 120));
    }

    return null;
}

function filterValuePattern(value) {
    const escaped = escapeRegExp(value);

    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");
}

async function clickNaturally(page, locator) {
    await moveMouseToLocator(page, locator).catch(() => {});
    return resilientClick(locator, {
        context: "search-pavel.clickNaturally", page,
        delay: randomInt(90, 190),
        timeout: 5000,
        pauseBeforeClick: () => naturalPause(page, 300, 800)
    });
}

async function isElementStable(target) {
    const firstBox = await target.boundingBox().catch(() => null);

    if (!firstBox) {
        return false;
    }

    await new Promise(resolve => setTimeout(resolve, 260));

    const secondBox = await target.boundingBox().catch(() => null);

    if (!secondBox) {
        return false;
    }

    return Math.abs(firstBox.x - secondBox.x) < 2 &&
        Math.abs(firstBox.y - secondBox.y) < 2 &&
        Math.abs(firstBox.width - secondBox.width) < 2 &&
        Math.abs(firstBox.height - secondBox.height) < 2;
}

async function isElementUncovered(target) {
    return await target.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            x < 0 ||
            y < 0 ||
            x > window.innerWidth ||
            y > window.innerHeight
        ) {
            return false;
        }

        const topElement = document.elementFromPoint(x, y);

        return topElement === element || element.contains(topElement);
    }).catch(() => false);
}

async function isElementInteractable(target) {
    const visible = await target.isVisible().catch(() => false);
    const enabled = await target.isEnabled().catch(() => true);

    return visible &&
        enabled &&
        await isElementStable(target) &&
        await isElementUncovered(target);
}

async function waitForAllFiltersButton(page) {
    const allFilters = page.getByRole("button", {
        name: /all filters/i
    });

    for (let attempt = 1; attempt <= 8; attempt++) {
        const visible = await allFilters.isVisible({
            timeout: 1200
        }).catch(() => false);
        const enabled = visible && await allFilters.isEnabled().catch(() => false);
        const stable = enabled && await isElementStable(allFilters);
        const uncovered = stable && await isElementUncovered(allFilters);

        if (visible && enabled && stable && uncovered) {
            console.log("All filters button visible.");
            return allFilters;
        }

        await naturalPause(page, 700, 1400);
        await moveMouseAroundPage(page).catch(() => {});
    }

    throw new Error("All filters button is not interactable yet.");
}

function currentCompaniesSectionLocator(scope) {
    const sectionPattern = /current compan(?:y|ies)/i;

    return scope.getByRole("heading", {
        name: sectionPattern
    }).or(scope.getByRole("button", {
        name: sectionPattern
    })).or(scope.getByText(sectionPattern));
}

function schoolsSectionLocator(scope) {
    return scope.getByRole("heading", {
        name: /^schools?$/i
    }).or(scope.getByRole("button", {
        name: /^schools?$/i
    })).or(scope.getByText(/^schools?$/i));
}

async function getPeopleFiltersDialog(page) {
    const roleDialog = page.getByRole("dialog", {
        name: /people filters|filters/i
    }).or(page.locator('[role="dialog"]')).first();

    await page.waitForFunction(() => {
        const visible = element => {
            if (!element) {
                return false;
            }

            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== "hidden" &&
                style.display !== "none";
        };
        const clean = value => (value || "").replace(/\s+/g, " ").trim();

        return [...document.querySelectorAll("button, a")]
            .some(element => visible(element) && /show results/i.test(clean(element.innerText || element.textContent)));
    }, undefined, {
        timeout: 10000
    });

    if (await roleDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log("People filters dialog opened.");
        return roleDialog;
    }

    const marker = `wpf-people-filters-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const marked = await page.evaluate(markerValue => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const visible = element => {
            if (!element) {
                return false;
            }

            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== "hidden" &&
                style.display !== "none";
        };
        const visibleArea = element => {
            const rect = element.getBoundingClientRect();

            return Math.max(0, rect.width) * Math.max(0, rect.height);
        };
        const showResults = [...document.querySelectorAll("button, a")]
            .find(element =>
                visible(element) &&
                /show results/i.test(clean(element.innerText || element.textContent))
            );

        if (!showResults) {
            return false;
        }

        let current = showResults;

        for (let depth = 0; current && depth < 10; depth++) {
            const text = clean(current.innerText || current.textContent);

            if (
                current !== document.body &&
                current !== document.documentElement &&
                visible(current) &&
                visibleArea(current) > 8000 &&
                /show results/i.test(text) &&
                /current compan(?:y|ies)|people filters|connections|locations|schools|profile language/i.test(text)
            ) {
                current.setAttribute("data-wpf-people-filters-panel", markerValue);
                return true;
            }

            current = current.parentElement;
        }

        return false;
    }, marker);

    if (!marked) {
        throw new Error("People filters panel was not found after opening All filters.");
    }

    console.log("People filters dialog opened.");
    return page.locator(`[data-wpf-people-filters-panel="${marker}"]`);
}

async function getDialogScrollContainer(dialog) {
    const dialogHandle = await dialog.elementHandle();

    if (!dialogHandle) {
        throw new Error("People filters dialog handle was not available.");
    }

    const scrollContainer = await dialogHandle.evaluateHandle(dialogElement => {
        const visibleArea = element => {
            const rect = element.getBoundingClientRect();

            return Math.max(0, rect.width) * Math.max(0, rect.height);
        };
        const candidates = [dialogElement, ...dialogElement.querySelectorAll("*")]
            .filter(element => {
                const style = window.getComputedStyle(element);

                return element.scrollHeight > element.clientHeight + 40 &&
                    /(auto|scroll|overlay)/i.test(style.overflowY);
            })
            .sort((a, b) => visibleArea(b) - visibleArea(a));

        return candidates[0] || dialogElement;
    });

    return scrollContainer.asElement() || dialogHandle;
}

async function scrollPeopleFilters(page, scrollContainer, minDistance = 120, maxDistance = 320) {
    const distance = randomInt(minDistance, maxDistance);

    console.log("Scrolling People filters...");
    await moveMouseAroundPage(page).catch(() => {});
    await scrollContainer.evaluate((element, deltaY) => {
        element.scrollBy({
            top: deltaY,
            behavior: "auto"
        });
    }, distance);
    await naturalPause(page, 700, 1600);
}

async function revealCurrentCompaniesSection(page, dialog, scrollContainer) {
    const section = currentCompaniesSectionLocator(dialog);

    for (let attempt = 1; attempt <= 8; attempt++) {
        const visibleSection = await findVisibleLocator(section, 700);

        if (visibleSection) {
            console.log("Current companies found.");
            await naturalPause(page, 600, 1300);
            return;
        }

        await scrollPeopleFilters(page, scrollContainer);
    }

    throw new Error("Current companies section was not visible inside People filters dialog.");
}

async function revealSchoolsSection(page, dialog, scrollContainer) {
    const section = schoolsSectionLocator(dialog);

    console.log("Searching Schools inside People Filters...");
    for (let attempt = 1; attempt <= 12; attempt++) {
        const visibleSection = await findVisibleLocator(section, 700);

        if (visibleSection) {
            console.log("Schools found.");
            await naturalPause(page, 600, 1300);
            return;
        }

        // Once the modal is open, only its own scroll container may move.
        await scrollPeopleFilters(page, scrollContainer);
    }

    throw new Error("Schools section was not visible inside People Filters dialog.");
}


async function openFilters(page) {

    const allFilters = await waitForAllFiltersButton(page);

    console.log("Opening All filters...");
    await clickNaturally(page, allFilters);

    const dialog = await getPeopleFiltersDialog(page);
    const scrollContainer = await getDialogScrollContainer(dialog);
    await naturalPause(page, 1200, 2600);

    return {
        dialog,
        scrollContainer
    };
}

async function searchCompanyFilterValue(page, dialog, scrollContainer, value) {
    const inputPattern = /company|current company|add a company|search company/i;

    await revealCurrentCompaniesSection(page, dialog, scrollContainer);

    const typeaheadInput = await findVisibleLocator(
        dialog.getByRole("textbox", {
            name: inputPattern
        }).or(dialog.getByPlaceholder(inputPattern)),
        1200
    );

    if (!typeaheadInput) {
        console.log("Company filter search box not visible. Looking for existing options.");
        return;
    }

    await prepareSearchBox(typeaheadInput);
    await typeLikeHuman(page, value);
    await naturalPause(page, 1200, 2200);
}

async function findFilterCheckbox(scope, value) {
    const exactPattern = filterValuePattern(value);
    const escapedPattern = new RegExp(escapeRegExp(value), "i");

    return await findVisibleLocator(
        scope.getByRole("checkbox", {
            name: exactPattern
        }).or(scope.getByRole("checkbox", {
            name: escapedPattern
        })),
        1500
    );
}

async function selectFilterCheckbox(page, dialog, value, label) {
    const checkbox = await findFilterCheckbox(dialog, value);

    if (!checkbox) {
        throw new Error(`${label} checkbox not found for "${value}".`);
    }

    if (await checkbox.isChecked().catch(() => false)) {
        return checkbox;
    }

    await checkbox.waitFor({ state: "visible", timeout: 5000 });
    await checkbox.scrollIntoViewIfNeeded({ timeout: 3000 });
    await moveMouseToLocator(page, checkbox).catch(error => {
        logRecoverable("selectFilterCheckbox", error.message, "continue with locator.check()");
    });
    await checkbox.hover({ timeout: 2000 }).catch(error => {
        logRecoverable("selectFilterCheckbox", error.message, "continue with locator.check()");
    });
    await naturalPause(page, 900, 1800);
    try {
        await checkbox.check({
            timeout: 5000
        });
    } catch (error) {
        logRecoverable("selectFilterCheckbox", error.message, "retry check with force as last resort");
        await checkbox.check({ timeout: 3000, force: true });
    }

    if (!(await checkbox.isChecked().catch(() => false))) {
        throw new Error(`${label} checkbox was not selected for "${value}".`);
    }

    return checkbox;
}

async function selectCompany(page, dialog, scrollContainer, company) {

    const companyName = cleanText(company);

    if (!companyName) {
        throw new Error("Company filter is required but no company was provided.");
    }

    console.log("Selecting company:");
    console.log(companyName);

    await searchCompanyFilterValue(page, dialog, scrollContainer, companyName);
    await selectFilterCheckbox(page, dialog, companyName, "Company");
    console.log("Company selected.");

    return true;
}

async function searchSchoolFilterValue(page, dialog, scrollContainer, value) {
    const inputPattern = /school|add a school|search school/i;

    await revealSchoolsSection(page, dialog, scrollContainer);
    const typeaheadInput = await findVisibleLocator(
        dialog.getByRole("textbox", {
            name: inputPattern
        }).or(dialog.getByPlaceholder(inputPattern)),
        1200
    );

    if (!typeaheadInput) {
        console.log("School search box not visible. Looking for existing school options.");
        return;
    }

    await prepareSearchBox(typeaheadInput);
    await typeLikeHuman(page, value);
    await naturalPause(page, 1200, 2200);
}

async function selectSchool(page, dialog, scrollContainer, school) {
    const schoolName = cleanText(school);

    if (!schoolName) {
        console.log("No school available. Skipping school filter.");
        return false;
    }

    console.log("Selecting school:", schoolName);
    await searchSchoolFilterValue(page, dialog, scrollContainer, schoolName);
    await selectFilterCheckbox(page, dialog, schoolName, "School");
    console.log("School selected.");
    return true;
}

async function findShowResultsControl(page, dialog) {
    const dialogButton = dialog.getByRole("button", {
        name: /show results/i
    });

    if (await dialogButton.isVisible({ timeout: 1500 }).catch(() => false)) {
        return dialogButton;
    }

    const pageButton = page.getByRole("button", {
        name: /show results/i
    });

    if (await pageButton.isVisible({ timeout: 1500 }).catch(() => false)) {
        return pageButton;
    }

    const textControl = page.getByText(/show results/i);

    if (await textControl.isVisible({ timeout: 1500 }).catch(() => false)) {
        return textControl;
    }

    return null;
}

async function showResults(page, dialog) {

    const showResults = await findShowResultsControl(page, dialog);

    if (!showResults) {
        throw new Error("Show results control not found.");
    }

    console.log("Show results found.");
    console.log("Clicking Show results...");
    await clickNaturally(page, showResults);

    console.log("Waiting for filtered results...");

    await page.locator("main").first().waitFor({
        state: "visible",
        timeout: 15000
    });

    return await waitForFilteredResults(page);
}

async function verifyFilterSelected(dialog, value, label) {
    const exactPattern = filterValuePattern(value);
    const escapedPattern = new RegExp(escapeRegExp(value), "i");
    const checkbox = dialog.getByRole("checkbox", {
        name: exactPattern
    }).or(dialog.getByRole("checkbox", {
        name: escapedPattern
    })).first();

    if (!(await checkbox.count())) {
        throw new Error(`${label} filter verification failed: checkbox not found.`);
    }

    if (!(await checkbox.isChecked().catch(() => false))) {
        throw new Error(`${label} filter verification failed: checkbox is not selected.`);
    }
}

async function verifySelectedFilters(dialog, company, school = "") {
    if (cleanText(company)) {
        await verifyFilterSelected(dialog, company, "Company");
        console.log("Company filter applied successfully.");
    }

    if (cleanText(school)) {
        await verifyFilterSelected(dialog, school, "School");
        console.log("School filter applied successfully.");
    }
}

async function waitForFilteredResults(page) {
    await page.waitForLoadState("domcontentloaded", {
        timeout: 15000
    }).catch(() => {});

    const stateHandle = await page.waitForFunction(() => {
        const mainText = (document.querySelector("main")?.innerText || "")
            .replace(/\s+/g, " ")
            .trim();
        const hasPeopleResults = document.querySelectorAll(`
            main [data-view-name="search-entity-result-universal-template"] a[href*="/in/"],
            main li a[href*="/in/"],
            main a[href*="/in/"]
        `).length > 0;
        const hasNoResults = /no results found|no matching results|try changing or removing some of your filters/i.test(mainText);

        if (!/\/search\/results\/people/i.test(window.location.href)) return false;
        if (hasPeopleResults) return "results";
        if (hasNoResults) return "empty";
        return false;
    }, undefined, {
        timeout: 15000
    });
    const resultState = await stateHandle.jsonValue();

    await naturalPause(page, 1800, 3400);
    if (resultState === "empty") {
        console.log("No mutual connections matched the selected filters.");
    } else {
        console.log("Search results detected.");
    }

    return resultState;
}

async function verifyActiveFilterState(page, requested = {}) {
    const requestedCompany = cleanText(requested.company);
    const requestedSchool = cleanText(requested.school);
    const state = await page.evaluate(() => {
        const activeButtons = [...document.querySelectorAll("button")]
            .filter(button => {
                const classes = button.className?.toString() || "";
                return button.getAttribute("aria-pressed") === "true" ||
                    /\b(active|selected|checked)\b/i.test(classes);
            })
            .map(button => (button.innerText || button.textContent || "").replace(/\s+/g, " ").trim());
        const url = window.location.href;

        return {
            activeButtons,
            companyActive: /[?&](?:currentCompany|facetCurrentCompany)=/i.test(url),
            schoolActive: /[?&](?:schoolFilter|facetSchool)=/i.test(url)
        };
    });
    const activeText = state.activeButtons.join(" ").toLowerCase();
    const companyActive = state.companyActive ||
        Boolean(requestedCompany && activeText.includes(requestedCompany.toLowerCase()));
    const schoolActive = state.schoolActive ||
        Boolean(requestedSchool && activeText.includes(requestedSchool.toLowerCase()));

    if (requestedCompany && !companyActive) {
        throw new Error("Requested Company filter is not active after Show Results.");
    }
    if (!requestedCompany && state.companyActive) {
        throw new Error("Unexpected Company filter is active after Show Results.");
    }
    if (requestedSchool && !schoolActive) {
        throw new Error("Requested School filter is not active after Show Results.");
    }
    if (!requestedSchool && state.schoolActive) {
        throw new Error("Unexpected School filter is active after Show Results.");
    }

    console.log("Active LinkedIn filters match the requested configuration.");
}

async function openLinkedInFeed(page) {

    console.log("Opening LinkedIn Home Feed...");

    const alreadyOnFeed = /linkedin\.com\/feed\/?/i.test(page.url());
    const searchInput = page.locator(SEARCH_INPUT_SELECTOR).first();

    if (
        alreadyOnFeed &&
        await searchInput.isVisible({ timeout: 1500 }).catch(() => false)
    ) {
        console.log("Home already loaded. Reusing current page.");
        await page.waitForTimeout(2000 + Math.floor(Math.random() * 3000));
        return;
    }

    await page.goto(
        LINKEDIN_HOME_URL,
        {
            waitUntil: "domcontentloaded",
            timeout: 45000
        }
    );

    await searchInput.waitFor({
        state: "visible",
        timeout: 15000
    });
    await page.waitForTimeout(2000 + Math.floor(Math.random() * 3000));
    console.log("Home loaded.");

}

function randomInt(min, max) {

    return min + Math.floor(Math.random() * (max - min + 1));

}

async function scrollFeed(page, distance) {

    try {
        return await page.evaluate(deltaY => {
            const isScrollable = element => {
                if (!element) {
                    return false;
                }

                const style = window.getComputedStyle(element);

                return element.scrollHeight > element.clientHeight + 80 &&
                    /(auto|scroll|overlay|visible)/i.test(style.overflowY);
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
            const beforeTop = target === document.documentElement || target === document.body
                ? window.scrollY
                : target.scrollTop;

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

            const afterTop = target === document.documentElement || target === document.body
                ? window.scrollY
                : target.scrollTop;

            return {
                beforeTop,
                afterTop,
                scrollHeight: target.scrollHeight,
                clientHeight: target.clientHeight
            };
        }, distance);
    } catch (err) {
        await page.mouse.wheel(0, distance).catch(() => {});
        return null;
    }

}

async function performInitialTargetSearchWarmup(page) {

    if (!HUMAN_BEHAVIOR_CONFIG.enableInitialHomeBrowsing) {
        console.log("Initial home browsing disabled by ENABLE_INITIAL_HOME_BROWSING.");
        return;
    }

    emitProgress("human_browsing");
    await performInitialHomeFeedCommentSession(page, {
        openLinkedInHome: openLinkedInFeed,
        scrollPage: scrollFeed,
        scrollMinPx: 120,
        scrollMaxPx: 400
    }, {
        ...HUMAN_BEHAVIOR_CONFIG,
        homeScrollDurationMs: HUMAN_BEHAVIOR_CONFIG.initialHomeBrowsingDurationMs
    }).catch(err => {
        logRecoverable(
            "performInitialTargetSearchWarmup",
            "human warm-up failed: " + err.message,
            "continuing to target search"
        );
    });

}

async function getSearchBox(page) {
    const searchBox = page.getByRole("combobox", { name: /search/i })
        .or(page.getByRole("searchbox", { name: /search/i }))
        .or(page.locator(SEARCH_INPUT_SELECTOR))
        .first();

    await searchBox.waitFor({
        state: "visible",
        timeout: 15000
    });

    return searchBox;

}


async function moveMouseToLocator(page, locator) {

    if (typeof locator.waitFor === "function") {
        await locator.waitFor({
            state: "visible",
            timeout: 10000
        });
    } else if (typeof locator.waitForElementState === "function") {
        await locator.waitForElementState("visible", {
            timeout: 10000
        });
    }

    const box = await locator.boundingBox();

    if (!box) {
        throw new Error("Element position could not be determined.");
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
    if (Math.random() < 0.2) {
        await page.mouse.move(targetX + randomInt(-18, 18), targetY + randomInt(-12, 12), {
            steps: randomInt(4, 9)
        }).catch(() => {});
        await page.waitForTimeout(80 + Math.floor(Math.random() * 180));
    }
    await page.mouse.move(targetX, targetY, {
        steps: randomInt(8, 18)
    });

}

async function prepareSearchBox(searchBox) {
    await searchBox.waitFor({ state: "visible", timeout: 5000 });
    await searchBox.scrollIntoViewIfNeeded();
    await searchBox.click({ timeout: 5000 });
    await searchBox.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await searchBox.press("Backspace");

    await searchBox.page().waitForTimeout(220 + Math.floor(Math.random() * 520));
}

async function typeTargetNameIntoSearch(page, searchBox, targetName, humanTyper = typeLikeHuman) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        await prepareSearchBox(searchBox);
        console.log("[LINKEDIN_SEARCH] Query type: target");
        console.log("[LINKEDIN_SEARCH] Human typing started");
        await humanTyper(page, targetName);
        console.log("[LINKEDIN_SEARCH] Human typing completed");
        const actualValue = await searchBox.inputValue();

        console.log("[TARGET_SEARCH_INPUT]", {
            expected: targetName,
            actual: actualValue
        });

        if (normalizeName(actualValue) === normalizeName(targetName)) {
            return;
        }
    }

    throw new Error("Failed to type target name into LinkedIn search.");
}

async function typeLikeHuman(page, text) {

    console.log("[HUMAN_TYPING] Helper: typeLikeHuman");
    console.log("[HUMAN_TYPING] Character delay range: 70-149ms | 120-279ms");
    console.log("[HUMAN_TYPING] Query length:", cleanText(text).length);
    await page.waitForTimeout(900 + Math.floor(Math.random() * 900));

    const value = cleanText(text);

    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        const keyDelay = Math.random() < 0.18
            ? 70 + Math.floor(Math.random() * 80)
            : 120 + Math.floor(Math.random() * 160);

        await page.keyboard.type(char, {
            delay: keyDelay
        });

        if (char === " ") {
            await page.waitForTimeout(220 + Math.floor(Math.random() * 420));
        } else if (Math.random() < 0.16) {
            await page.waitForTimeout(160 + Math.floor(Math.random() * 520));
        } else {
            await page.waitForTimeout(70 + Math.floor(Math.random() * 180));
        }

        if (
            index > 1 &&
            index < value.length - 1 &&
            Math.random() < 0.045
        ) {
            const typo = "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];

            await page.keyboard.type(typo, {
                delay: 50 + Math.floor(Math.random() * 90)
            });
            await page.waitForTimeout(180 + Math.floor(Math.random() * 420));
            await page.keyboard.press("Backspace");
            await page.waitForTimeout(120 + Math.floor(Math.random() * 280));
        }

    }

}



async function clickLikeHuman(locator, pageOverride = null) {
    const page = pageOverride ||
        (typeof locator.page === "function" ? locator.page() : null);

    return resilientClick(locator, {
        context: "search-pavel.clickLikeHuman", page,
        delay: 70 + Math.floor(Math.random() * 110),
        timeout: 7000,
        pauseBeforeClick: page ? () => page.waitForTimeout(300 + Math.floor(Math.random() * 500)) : null
    });
}

async function collectConnectionCandidates(page) {
    return await page.locator("a").evaluateAll(links => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();

        return links
            .map(link => {
                const rect = link.getBoundingClientRect();
                const href = link.href || link.getAttribute("href") || "";
                const text = clean(link.innerText || link.textContent);
                const style = window.getComputedStyle(link);

                return {
                    text,
                    href,
                    visible: rect.width > 0 &&
                        rect.height > 0 &&
                        style.visibility !== "hidden" &&
                        style.display !== "none"
                };
            })
            .filter(candidate =>
                candidate.text.toLowerCase().includes("connections") &&
                /\/search\/results\/people|facetNetwork|connectionOf|network/i.test(candidate.href)
            );
    }).catch(() => []);
}

async function markConnectionCandidate(page, candidate) {
    if (!candidate) {
        return "";
    }

    const marker = `connections-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const marked = await page.evaluate(({ href, markerValue }) => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const links = [...document.querySelectorAll("a")];

        for (const link of links) {
            link.removeAttribute("data-wpf-connections-link");
        }

        const target = links.find(link =>
            (link.href || link.getAttribute("href") || "") === href &&
            clean(link.innerText || link.textContent).toLowerCase().includes("connections")
        );

        if (!target) {
            return false;
        }

        target.setAttribute("data-wpf-connections-link", markerValue);
        return true;
    }, {
        href: candidate.href,
        markerValue: marker
    }).catch(() => false);

    return marked ? marker : "";
}

function connectionMarkerSelector(marker) {
    return `[data-wpf-connections-link="${marker}"]`;
}

async function scrollTargetProfileUpForConnections(page) {
    console.log("Returning toward profile top to find Connections...");

    for (let attempt = 1; attempt <= 14; attempt++) {
        const visibleCandidate = (await collectConnectionCandidates(page))
            .find(candidate => candidate.visible);

        if (visibleCandidate) {
            console.log("Connections link is visible near profile header.");
            await page.waitForTimeout(randomInt(900, 1800)).catch(() => {});
            return visibleCandidate;
        }

        await moveMouseAroundPage(page).catch(() => {});
        await scrollPageLikeHuman(page, -randomInt(140, 360)).catch(() => {});
        await page.waitForTimeout(randomInt(1200, 2800)).catch(() => {});

        if (Math.random() < 0.22) {
            console.log("Reading profile header area while returning up...");
            await page.waitForTimeout(randomInt(1800, 4200)).catch(() => {});
        }
    }

    return (await collectConnectionCandidates(page))
        .find(candidate => candidate.visible) ||
        null;
}

async function moveMouseAroundPage(page) {
    const viewport = page.viewportSize();

    if (!viewport) {
        return;
    }

    const startX = randomInt(90, Math.max(120, viewport.width - 160));
    const startY = randomInt(100, Math.max(130, viewport.height - 160));
    const endX = randomInt(90, Math.max(120, viewport.width - 160));
    const endY = randomInt(100, Math.max(130, viewport.height - 160));
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

async function scrollPageLikeHuman(page, distance) {
    const moved = await page.evaluate(deltaY => {
        const isScrollable = element => {
            if (!element) {
                return false;
            }

            const style = window.getComputedStyle(element);

            return element.scrollHeight > element.clientHeight + 80 &&
                /(auto|scroll|overlay|visible)/i.test(style.overflowY);
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
            if (deltaY < 0) {
                return element.scrollTop > 4;
            }

            return element.scrollTop + element.clientHeight < element.scrollHeight - 4;
        };
        const candidates = [
            document.scrollingElement,
            document.documentElement,
            document.body,
            ...document.querySelectorAll("main, main *, div, section")
        ]
            .filter(isScrollable)
            .filter(canMove)
            .filter(element => visibleArea(element) > 20000)
            .sort((a, b) => visibleArea(b) - visibleArea(a));
        const target = candidates[0] || document.scrollingElement || document.documentElement;
        const beforeTop = target === document.documentElement || target === document.body
            ? window.scrollY
            : target.scrollTop;

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

        const afterTop = target === document.documentElement || target === document.body
            ? window.scrollY
            : target.scrollTop;

        return beforeTop !== afterTop;
    }, distance).catch(() => false);

    if (!moved) {
        await page.mouse.wheel(0, distance).catch(() => {});
    }
}

async function waitForProfileToLoad(page, expectedUrl = "") {

    await page.waitForURL(
        url => {
            const normalized = normalizeProfileUrl(url.href);

            return Boolean(
                normalized &&
                (!expectedUrl || normalized === expectedUrl)
            ) || isUnexpectedLinkedInUrl(url.href);
        },
        {
            timeout: 15000
        }
    );

    await page.locator("main").first().waitFor({
        state: "visible",
        timeout: 15000
    });

    console.log("Profile opened:");
    console.log(page.url());

    if (isUnexpectedLinkedInUrl(page.url())) {
        throw new Error("LinkedIn redirected to login, checkpoint, or unavailable page.");
    }

    if (expectedUrl && normalizeProfileUrl(page.url()) !== expectedUrl) {
        throw new Error(
            "Opened target URL mismatch. Expected " +
            expectedUrl +
            " but opened " +
            (normalizeProfileUrl(page.url()) || page.url())
        );
    }

}

async function openConnections(page) {

    emitProgress("opening_connections");

    console.log("Opening Connections...");

    console.log("Looking for 500+ connections...");

    const visibleFromTop = await scrollTargetProfileUpForConnections(page);
    const candidates = await collectConnectionCandidates(page);
    const selected = visibleFromTop ||
        candidates.find(candidate => candidate.visible) ||
        candidates[0];

    if (!selected?.href) {

        throw new Error("Connections link not found.");

    }

    const connectionsUrl = new URL(selected.href, page.url()).href;
    console.log("Found:", selected.text || "connections link");

    if (!selected.visible) {
        throw new Error("Connections link was found but could not be made visible for a human click.");
    }

    const marker = await markConnectionCandidate(page, selected);
    const connectionLink = marker
        ? page.locator(connectionMarkerSelector(marker))
        : null;

    if (!connectionLink) {
        throw new Error("Connections link could not be re-identified after DOM scan.");
    }

    await connectionLink.scrollIntoViewIfNeeded({ timeout: 2000 });
    await naturalPause(page, 350, 800);
    await clickLikeHuman(connectionLink, page);

    return connectionsUrl;

}

async function scrollTargetProfileUntilStable(page) {
    console.log("TARGET_PROFILE_SCROLL_STARTED");
    let stableCycles = 0;
    let previousHeight = 0;
    let previousScrollY = -1;

    for (let cycle = 1; cycle <= 16; cycle += 1) {
        const before = await page.evaluate(() => ({
            scrollY: window.scrollY,
            height: document.documentElement.scrollHeight,
            viewport: window.innerHeight
        }));
        const distance = Math.max(180, Math.round(before.viewport * 0.65));
        await scrollPageLikeHuman(page, distance);
        await naturalPause(page, 700, 1400);
        const after = await page.evaluate(() => ({
            scrollY: window.scrollY,
            height: document.documentElement.scrollHeight
        }));
        const atBottom = after.scrollY + before.viewport >= after.height - 30;
        const unchanged = after.height === previousHeight && after.scrollY === previousScrollY;
        stableCycles = atBottom && unchanged ? stableCycles + 1 : 0;
        previousHeight = after.height;
        previousScrollY = after.scrollY;
        console.log("TARGET_PROFILE_SCROLL_CYCLE", {
            cycle,
            scrollY: after.scrollY,
            documentHeight: after.height,
            atBottom,
            stableCycles
        });
        if (stableCycles >= 3) break;
    }

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await naturalPause(page, 800, 1400);
    if (!/linkedin\.com\/in\//i.test(page.url())) {
        throw new Error("Target profile URL changed during target-profile scrolling.");
    }
    console.log("TARGET_PROFILE_STABLE");
}

async function extractTargetSupplementalDetails(page) {
    return page.evaluate(() => {
        const clean = value => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        const sectionByHeading = pattern => [...document.querySelectorAll("main section")]
            .filter(section => !section.closest("aside"))
            .find(section => pattern.test(clean(
                section.querySelector("h2, h3, [role='heading']")?.innerText ||
                section.querySelector("[aria-hidden='true']")?.innerText
            )));
        const usefulLines = section => section
            ? [...section.querySelectorAll("li, [role='listitem'], article")]
                .map(item => clean(item.innerText))
                .filter(Boolean)
                .slice(0, 10)
            : [];
        const activitySection = sectionByHeading(/^(Activity|Recent activity)$/i);
        const mutualSection = sectionByHeading(/mutual connections?/i);
        const mutualLinks = mutualSection
            ? [...mutualSection.querySelectorAll('a[href*="/in/"]')]
                .map(link => ({
                    name: clean(link.innerText).split("\n")[0],
                    linkedin_url: link.href.split("?")[0]
                }))
                .filter(item => item.name && item.linkedin_url)
                .slice(0, 20)
            : [];

        return {
            recent_activity: usefulLines(activitySection),
            mutual_connections: mutualLinks
        };
    }).catch(() => ({ recent_activity: [], mutual_connections: [] }));
}

async function processTargetProfile(page, target) {
    const expectedUrl = normalizeProfileUrl(target.linkedin_url || target.url);
    console.log("[TARGET] Reading profile header");
    console.log("[TARGET] Scrolling through profile");

    // scrapeProfile fully awaits the existing human-reading, lazy-rendering, and
    // section retry pipeline before returning any target data.
    const extracted = await scrapeProfile(page, { targetProfile: true });

    if (expectedUrl && normalizeProfileUrl(page.url()) !== expectedUrl) {
        throw new Error("Target profile changed before extraction completed.");
    }
    if (!cleanText(extracted.name)) {
        throw new Error("Target profile extraction did not return a name.");
    }
    const { assertTargetProfileMatch } = await import("../types/target-search-request.ts");
    assertTargetProfileMatch(target, extracted, page.url());
    console.log("[TARGET] Identity verified", {
        workflow_run_id: process.env.WORKFLOW_RUN_ID || null,
        search_request_id: process.env.SEARCH_REQUEST_ID || null,
        requested_name: target.name,
        extracted_name: extracted.name,
        requested_linkedin_url: target.linkedin_url || target.url || null,
        extracted_linkedin_url: extracted.linkedin_url || page.url()
    });

    console.log("[TARGET] Reading About section");
    console.log("[TARGET] Reading Experience section");
    console.log("[TARGET] Reading Education section");
    console.log("[TARGET] Reading Skills section");
    console.log("[TARGET] Reading activity and mutual connections");
    const supplemental = await extractTargetSupplementalDetails(page);
    const merged = mergeTargetProfile(target, { ...extracted, ...supplemental });
    saveTargetProfile(merged);

    const stored = loadTargetProfile();
    if (!cleanText(stored.name) || normalizeProfileUrl(stored.linkedin_url || stored.url) !== normalizeProfileUrl(merged.linkedin_url || merged.url)) {
        throw new Error("Stored target profile failed completion verification.");
    }

    console.log("[TARGET] Target profile extraction completed");
    return stored;
}

async function waitForConnectionsPage(page, expectedUrl = "") {
    const expectedHref = expectedUrl || "";

    await page.waitForURL(url => {
        return /\/search\/results\/people/i.test(url.href) ||
            isUnexpectedLinkedInUrl(url.href);
    }, {
        timeout: 12000
    }).catch(err => {
        throw new Error(
            "Connections click did not complete the expected page transition" +
            (expectedHref ? ` to ${expectedHref}` : "") +
            ": " + err.message
        );
    });

    if (isUnexpectedLinkedInUrl(page.url())) {
        throw new Error("LinkedIn redirected away while opening connections.");
    }

    await page.locator("main").first().waitFor({
        state: "visible",
        timeout: 15000
    });

    await page.waitForFunction(() => {
        const mainText = (document.querySelector("main")?.innerText || "")
            .replace(/\s+/g, " ")
            .trim();

        return /all filters|connections?|people|results/i.test(mainText) ||
            document.querySelectorAll('main a[href*="/in/"]').length > 0;
    }, undefined, {
        timeout: 10000
    }).catch(err => {
        logRecoverable(
            "waitForConnectionsPage",
            "connections content was not strongly verified: " + err.message,
            "continuing with visible search page"
        );
    });

    console.log("Connections page loaded.");

    console.log(page.url());
    console.log("Reading connections page...");
    await naturalPause(page, 2000, 5000);

}

async function applyConnectionFilters(page, target) {

    const company = getTargetCompany(target);
    const school = getTargetSchool(target);

    console.log("Target configuration loaded.");
    console.log("Company:", company || "None");
    console.log("School:", school || "None");
    console.log("Keywords:", cleanText(target.keywords) || "None");

    if (!company && !school) {
        console.log("No Company or School filter requested. Keeping current Connections results.");
        return await waitForFilteredResults(page);
    }

    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (attempt > 1) {
                console.log("Retrying connection filter workflow...");
            }

            const {
                dialog,
                scrollContainer
            } = await openFilters(page);

            if (company) {
                console.log("Company detected. Applying Company filter.");
                await selectCompany(page, dialog, scrollContainer, company);
                await naturalPause(page, 900, 1800);
            } else {
                console.log("Company not requested. Skipping Company filter.");
            }

            if (school) {
                console.log("School detected. Applying School filter.");
                await selectSchool(page, dialog, scrollContainer, school);
                await naturalPause(page, 700, 1500);
            } else {
                console.log("School not requested. Skipping School filter.");
            }

            await verifySelectedFilters(dialog, company, school);
            const resultState = await showResults(page, dialog);
            await verifyActiveFilterState(page, { company, school });
            return resultState;
        } catch (err) {
            lastError = err;
            console.log("Connection filter workflow failed:", err.message);

            if (attempt >= 2) {
                break;
            }

            await page.keyboard.press("Escape").catch(() => {});
            await naturalPause(page, 1000, 2000);
        }
    }

    throw new Error(
        "Connection filters were not applied. Stopping before mutual collection. Reason: " +
        (lastError?.message || "unknown filter failure")
    );

}


async function getSearchSuggestions(page) {

    const profileAnchors = page.locator(
        '[role="listbox"] a[href*="/in/"]'
    );

    const containers = page.locator(
        '[role="listbox"] [role="option"]:has(a[href*="/in/"]), ' +
        '[role="listbox"] li:has(a[href*="/in/"])'
    );

    try {
        await profileAnchors.first().waitFor({
            state: "visible",
            timeout: 10000
        });

        console.log("Suggestions appeared.");

        const containerCount = await containers.count().catch(() => 0);

        return containerCount > 0
            ? containers
            : profileAnchors;

    } catch (error) {
        console.log(
            "Search suggestions did not appear. Continuing with LinkedIn People results."
        );

        return null;
    }
}

async function profileAnchorForSuggestion(suggestion, normalizedTargetHref) {
    const directHref = await suggestion.getAttribute("href").catch(() => "");
    if (normalizeLinkedInProfilePath(directHref)) {
        return { anchor: suggestion, href: directHref };
    }

    const anchors = suggestion.locator('a[href*="/in/"]');
    const anchorCount = await anchors.count().catch(() => 0);
    let firstValid = null;

    for (let anchorIndex = 0; anchorIndex < anchorCount; anchorIndex += 1) {
        const anchor = anchors.nth(anchorIndex);
        const href = await anchor.getAttribute("href").catch(() => "");
        const normalizedHref = normalizeLinkedInProfilePath(href);
        if (!normalizedHref) continue;
        if (!firstValid) firstValid = { anchor, href };
        if (normalizedTargetHref && normalizedHref === normalizedTargetHref) {
            return { anchor, href };
        }
    }

    return firstValid;
}

async function clickMatchedProfileAnchor(page, match, normalizedTargetHref) {
    console.log("Selected suggestion:", { text: match.text, href: match.href });
    await match.anchor.scrollIntoViewIfNeeded();
    await moveMouseToLocator(page, match.anchor);
    await page.waitForTimeout(250 + Math.floor(Math.random() * 450));
    await clickLikeHuman(match.anchor, page);

    if (normalizedTargetHref) {
        await page.waitForURL(
            url => normalizeLinkedInProfilePath(url.toString()) === normalizedTargetHref,
            { timeout: 30000 }
        );
        await waitForProfileToLoad(page, normalizeProfileUrl(match.href));
    } else {
        await waitForProfileToLoad(page);
    }

    const openedPath = normalizeLinkedInProfilePath(page.url());
    if (!openedPath || (normalizedTargetHref && openedPath !== normalizedTargetHref)) {
        throw new Error("Selected LinkedIn suggestion did not open the requested profile.");
    }

    console.log("Target profile opened successfully.");
}

async function selectTargetFromSuggestions(page, target, suggestions) {
    const normalizedTargetHref = normalizeLinkedInProfilePath(target.linkedin_url || target.url);
    const targetName = normalizeName(target.name);
    const suggestionCount = Math.min(await suggestions.count(), 12);

    for (let index = 0; index < suggestionCount; index += 1) {
        const suggestion = suggestions.nth(index);
        if (!(await suggestion.isVisible().catch(() => false))) continue;

        const text = await suggestion.innerText().catch(() => "");
        const profileLink = await profileAnchorForSuggestion(suggestion, normalizedTargetHref);
        const href = profileLink?.href || "";
        const normalizedHref = normalizeLinkedInProfilePath(href);
        const candidateName = normalizeName(text.split(/\r?\n/).find(Boolean) || "");
        const nameMatches = Boolean(targetName && candidateName === targetName);
        const urlMatches = Boolean(normalizedTargetHref && normalizedHref === normalizedTargetHref);

        console.log(`Reading target suggestion ${index + 1}/${suggestionCount}.`);
        console.log("[TARGET_SUGGESTION]", {
            index,
            text,
            candidateName,
            headline: text.split(/\r?\n/).slice(1).join(" ").trim(),
            company: getTargetCompany(target),
            location: cleanText(target.location),
            href,
            normalizedHref,
            targetName,
            targetUrl: normalizedTargetHref,
            nameMatches,
            urlMatches,
            isProfileResult: Boolean(normalizedHref)
        });

        if (urlMatches) {
            console.log("Exact target suggestion found.");
            console.log("Exact target URL match found.");
            await clickMatchedProfileAnchor(page, { ...profileLink, text }, normalizedTargetHref);
            return true;
        }

        if (!normalizedTargetHref && nameMatches && profileLink) {
            await clickMatchedProfileAnchor(page, { ...profileLink, text }, "");
            return true;
        }
    }

    return false;
}

async function openTargetFromPeopleResults(page, target, searchBox) {
    const normalizedTargetHref = normalizeLinkedInProfilePath(target.linkedin_url || target.url);
    const targetName = normalizeName(target.name || target.linkedin_name);

    console.log("No exact dropdown match.");
    console.log("Checking people search results.");
    await searchBox.press("Enter");
    console.log("[LINKEDIN_SEARCH] Search submitted");
    await page.waitForURL(url => /\/search\/results\//i.test(url.pathname), { timeout: 30000 });
    console.log("[LINKEDIN_SEARCH] Navigation/results detected");
    console.log("[LINKEDIN_SEARCH] Search input focused:",
        typeof searchBox.evaluate === "function"
            ? await searchBox.evaluate(element => element === document.activeElement).catch(() => false)
            : false);

    const anchors = page.locator('main a[href*="/in/"]');
    await anchors.first().waitFor({ state: "visible", timeout: 15000 });
    const count = Math.min(await anchors.count(), 50);

    for (let index = 0; index < count; index += 1) {
        const anchor = anchors.nth(index);
        const href = await anchor.getAttribute("href").catch(() => "");
        const text = await anchor.innerText().catch(() => "");
        const hrefMatches = Boolean(
            normalizedTargetHref &&
            normalizeLinkedInProfilePath(href) === normalizedTargetHref
        );
        const candidateName = normalizeName(text.split(/\r?\n/).find(Boolean) || "");
        const nameMatches = Boolean(!normalizedTargetHref && targetName && candidateName === targetName);
        if (!hrefMatches && !nameMatches) continue;
        console.log(hrefMatches ? "Exact target URL match found." : "Exact target name match found.");
        await clickMatchedProfileAnchor(page, { anchor, href, text }, normalizedTargetHref);
        return true;
    }

    return false;
}

async function openTargetProfileBySearch(page, target) {
    const targetName = String(target?.name || target?.linkedin_name || "").trim();
    if (!targetName) {
        throw new Error("Target name is required for LinkedIn search.");
    }

    const searchBox = await getSearchBox(page);

    console.log("[LINKEDIN_SEARCH] Search input located");
    console.log("Search box found.");
    console.log("Searching target:", targetName);
    emitProgress("searching_target", `Searching for ${targetName}...`);

    await moveMouseToLocator(page, searchBox);
    await typeTargetNameIntoSearch(page, searchBox, targetName);
    await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));

   const suggestions = await getSearchSuggestions(page);

await page.waitForTimeout(
    1500 + Math.floor(Math.random() * 700)
);

let dropdownMatch = false;

if (suggestions) {
    dropdownMatch = await selectTargetFromSuggestions(
        page,
        target,
        suggestions
    );
} else {
    console.log(
        "Skipping dropdown selection because LinkedIn did not display suggestions."
    );
}

if (
    !dropdownMatch &&
    !await openTargetFromPeopleResults(page, target, searchBox)
) {
        const hasTargetUrl = Boolean(normalizeLinkedInProfilePath(target.linkedin_url || target.url));
        throw new Error(hasTargetUrl
            ? "Target profile URL not found in LinkedIn search results."
            : "Target not found in LinkedIn search suggestions.");
    }
    if (dropdownMatch) {
        console.log("[LINKEDIN_SEARCH] Search submitted");
        console.log("[LINKEDIN_SEARCH] Navigation/results detected");
        console.log("[LINKEDIN_SEARCH] Search input focused:", await page.evaluate(
            () => document.activeElement?.matches?.('input[placeholder*="Search" i]') || false
        ).catch(() => false));
    }

    console.log("[TARGET] Target profile loaded");
    emitProgress("target_profile_opened");
}

async function runSearchPipeline(page, testOverrides = {}) {
    const target = testOverrides.target || loadTargetProfile();

    console.log("Target configuration loaded.");
    console.log("LinkedIn URL loaded:", target.linkedin_url || target.url || "Not provided");
    console.log("Company loaded:", getTargetCompany(target) || "Not provided");
    console.log("School loaded:", getTargetSchool(target) || "No school available");

    await (testOverrides.openLinkedInFeed || openLinkedInFeed)(page);
    await (testOverrides.performInitialTargetSearchWarmup || performInitialTargetSearchWarmup)(page);

    console.log("[TARGET] Opening target profile");
    console.log("Target opening strategy: SEARCH_BY_NAME");
    await (testOverrides.openTargetProfileBySearch || openTargetProfileBySearch)(page, target);

    if (testOverrides.stopAfterTargetOpening) {
        return page;
    }

    emitProgress("extracting_target");
    const currentTarget = await processTargetProfile(page, loadTargetProfile());

    console.log("[TARGET] Opening Connections page");
    const connectionsUrl = await openConnections(page);

    await waitForConnectionsPage(page, connectionsUrl);
    console.log("Target connections opened.");

    const filteredResultState = await applyConnectionFilters(page, currentTarget);
    if (filteredResultState === "empty") {
        console.log("Mutual collection will stop safely because LinkedIn returned no results.");
    } else {
        console.log("Beginning mutual collection.");
    }
    return page;
}

module.exports = runSearchPipeline;
module.exports.getTargetCompany = getTargetCompany;
module.exports.getTargetSchool = getTargetSchool;
module.exports.prepareSearchBox = prepareSearchBox;
module.exports.openTargetProfileBySearch = openTargetProfileBySearch;
module.exports.validateLinkedInProfileUrl = validateLinkedInProfileUrl;
module.exports.normalizeLinkedInProfilePath = normalizeLinkedInProfilePath;
module.exports.normalizeName = normalizeName;
module.exports.selectTargetFromSuggestions = selectTargetFromSuggestions;
module.exports.openTargetFromPeopleResults = openTargetFromPeopleResults;
module.exports.typeTargetNameIntoSearch = typeTargetNameIntoSearch;
