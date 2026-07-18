const {
    loadTargetProfile
} = require("../utils/loadTargetProfile");

const {
    mergeTargetProfile
} = require("../utils/mergeTargetProfile");

const {
    saveTargetProfile
} = require("../utils/saveTargetProfile");

const {
    scrapeProfile
} = require("./scrape-profile-details");
const {
    HUMAN_BEHAVIOR_CONFIG
} = require("../utils/HumanBehaviorConfig");
const {
    performInitialHomeFeedCommentSession
} = require("./HumanActivity");

const fs = require("fs");
const path = require("path");

const LINKEDIN_HOME_URL = "https://www.linkedin.com/feed/";
const SEARCH_INPUT_SELECTOR = 'input[placeholder*="Search"]';

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
    const currentExperience = Array.isArray(target.experience)
        ? target.experience.find(item => item?.duration?.currently_working === true)
        : null;

    return firstNonEmpty([
        target.company,
        target.current_company,
        currentExperience?.company
    ]);
}

async function naturalPause(page, minMs = 300, maxMs = 800) {
    await page.waitForTimeout(randomInt(minMs, maxMs));
}

async function findVisibleLocator(locator, timeout = 1500) {
    const deadline = Date.now() + timeout;

    while (Date.now() <= deadline) {
        const handles = await locator.elementHandles().catch(() => []);

        for (const handle of handles) {
            const visible = await handle.evaluate(element => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== "hidden" &&
                    style.display !== "none";
            }).catch(() => false);

            if (visible) {
                return handle;
            }
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
    await locator.scrollIntoViewIfNeeded({
        timeout: 3000
    }).catch(() => {});
    await moveMouseToLocator(page, locator).catch(() => {});
    await locator.hover({
        timeout: 2000
    }).catch(() => {});
    await naturalPause(page, 300, 800);
    await locator.click({
        delay: randomInt(90, 190),
        timeout: 5000
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

    await clickNaturally(page, typeaheadInput);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await naturalPause(page, 120, 280);
    await page.keyboard.press("Backspace");
    await naturalPause(page, 180, 420);
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

    await clickNaturally(page, checkbox);
    await naturalPause(page, 900, 1800);

    if (!(await checkbox.isChecked().catch(() => false))) {
        await checkbox.check({
            timeout: 5000
        }).catch(() => {});
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

    await waitForFilteredResults(page);
}

async function verifyFilterSelected(dialog, value, label) {
    const checkbox = await findFilterCheckbox(dialog, value);

    if (!checkbox) {
        throw new Error(`${label} filter verification failed: checkbox not found.`);
    }

    if (!(await checkbox.isChecked().catch(() => false))) {
        throw new Error(`${label} filter verification failed: checkbox is not selected.`);
    }
}

async function verifySelectedFilters(dialog, company) {
    await verifyFilterSelected(dialog, company, "Company");
}

async function waitForFilteredResults(page) {
    await page.waitForLoadState("domcontentloaded", {
        timeout: 15000
    }).catch(() => {});

    await page.waitForFunction(() => {
        const mainText = (document.querySelector("main")?.innerText || "")
            .replace(/\s+/g, " ")
            .trim();
        const hasPeopleResults = document.querySelectorAll('main a[href*="/in/"]').length > 0;

        return /\/search\/results\/people/i.test(window.location.href) &&
            (hasPeopleResults || /people|results|connections/i.test(mainText));
    }, undefined, {
        timeout: 15000
    });

    await naturalPause(page, 1800, 3400);
    console.log("Filtered results loaded.");
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

const searchBox = page.locator(SEARCH_INPUT_SELECTOR).first();

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

    await searchBox.hover({
        timeout: 2000
    }).catch(() => {});
    await searchBox.page().waitForTimeout(400 + Math.floor(Math.random() * 800));
    await searchBox.click({
        delay: 90 + Math.floor(Math.random() * 140),
        timeout: 5000
    });

    if (Math.random() < 0.18) {
        await searchBox.page().waitForTimeout(180 + Math.floor(Math.random() * 360));
        await searchBox.click({
            delay: 80 + Math.floor(Math.random() * 120),
            timeout: 3000
        }).catch(() => {});
    }

    await searchBox.page().waitForTimeout(500 + Math.floor(Math.random() * 1000));

    await searchBox.page().keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await searchBox.page().waitForTimeout(180 + Math.floor(Math.random() * 420));

    if (Math.random() < 0.35) {
        const currentText = await searchBox.inputValue().catch(() => "");

        for (let i = 0; i < Math.min(currentText.length, 24); i++) {
            await searchBox.page().keyboard.press("Backspace");
            await searchBox.page().waitForTimeout(35 + Math.floor(Math.random() * 95));
        }
    } else {
        await searchBox.page().keyboard.press("Backspace");
    }

    await searchBox.page().waitForTimeout(220 + Math.floor(Math.random() * 520));

}




async function typeLikeHuman(page, text) {

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

    await locator.hover({
        timeout: 2000
    }).catch(() => {});

    if (page) {
        await page.waitForTimeout(300 + Math.floor(Math.random() * 500));
    }

    await locator.click({
        delay: 70 + Math.floor(Math.random() * 110),
        timeout: 7000
    });

}

async function collectConnectionCandidates(page) {
    return await page.locator("a").evaluateAll(links => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();

        return links
            .map((link, index) => {
                const rect = link.getBoundingClientRect();
                const href = link.href || link.getAttribute("href") || "";
                const text = clean(link.innerText || link.textContent);
                const style = window.getComputedStyle(link);

                return {
                    index,
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

    const marked = await page.evaluate(({ index, href, markerValue }) => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const links = [...document.querySelectorAll("a")];

        for (const link of links) {
            link.removeAttribute("data-wpf-connections-link");
        }

        const target = links[index] ||
            links.find(link =>
                (link.href || link.getAttribute("href") || "") === href &&
                clean(link.innerText || link.textContent).toLowerCase().includes("connections")
            );

        if (!target) {
            return false;
        }

        target.setAttribute("data-wpf-connections-link", markerValue);
        return true;
    }, {
        index: candidate.index,
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

    if (selected.visible) {
        const marker = await markConnectionCandidate(page, selected);
        const connectionLink = marker
            ? page.locator(connectionMarkerSelector(marker))
            : null;

        try {
            if (!connectionLink) {
                throw new Error("Connections link could not be re-identified after DOM scan.");
            }

            await connectionLink.scrollIntoViewIfNeeded({
                timeout: 2000
            }).catch(() => {});
            await clickLikeHuman(connectionLink);
            return connectionsUrl;
        } catch (err) {
            logRecoverable(
                "openConnections",
                "connections click failed: " + err.message,
                "opening captured connections URL directly"
            );
        }
    } else {
        logRecoverable(
            "openConnections",
            "connections link was found but not visible",
            "opening captured connections URL directly"
        );

    }

    await page.goto(connectionsUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000
    });

    return connectionsUrl;

}

async function waitForConnectionsPage(page, expectedUrl = "") {
    const expectedHref = expectedUrl || "";

    await page.waitForURL(url => {
        return /\/search\/results\/people/i.test(url.href) ||
            isUnexpectedLinkedInUrl(url.href);
    }, {
        timeout: 12000
    }).catch(async err => {
        if (!expectedHref) {
            throw err;
        }

        logRecoverable(
            "waitForConnectionsPage",
            "SPA click did not verify connections URL: " + err.message,
            "opening captured connections URL directly"
        );

        await page.goto(expectedHref, {
            waitUntil: "domcontentloaded",
            timeout: 20000
        });
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

    if (!company) {
        throw new Error("Company filter is mandatory, but target.json has no company/current_company.");
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

            await selectCompany(page, dialog, scrollContainer, company);
            await naturalPause(page, 900, 1800);
            await verifySelectedFilters(dialog, company);
            await showResults(page, dialog);
            return;
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

    const suggestions = page.locator('[role="listbox"] a[href*="/in/"]');

    await suggestions.first().waitFor({
        state: "visible",
        timeout: 10000
    });

    console.log("Suggestions appeared.");

    return suggestions;

}

async function openTargetProfileBySearch(page, target) {
    const searchBox = await getSearchBox(page);

    console.log("Search box found!");
    console.log("Searching target...");

    await moveMouseToLocator(page, searchBox);
    await prepareSearchBox(searchBox);
    await typeLikeHuman(page, target.name);
    await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));

    const suggestions = await getSearchSuggestions(page);
    await page.waitForTimeout(1500 + Math.floor(Math.random() * 700));
    const suggestionHandles = (await suggestions.elementHandles()).slice(0, 12);
    const targetName = cleanText(target.name).toLowerCase();
    const targetCompany = getTargetCompany(target).toLowerCase();
    const expectedTargetUrl = normalizeProfileUrl(target.linkedin_url || target.url);
    let bestFallbackSuggestion = null;

    for (const [index, suggestion] of suggestionHandles.entries()) {
        const suggestionText = await suggestion.innerText().catch(() => "");
        const suggestionUrl = normalizeProfileUrl(
            await suggestion.getAttribute("href").catch(() => "")
        );

        console.log(`Suggestion ${index + 1}/${suggestionHandles.length}:`, suggestionText);

        const normalizedSuggestion = suggestionText.toLowerCase();
        const matchesTargetName = normalizedSuggestion.includes(targetName);
        const matchesTargetCompany = !targetCompany ||
            normalizedSuggestion.includes(targetCompany);
        const matchesTargetUrl = Boolean(
            expectedTargetUrl &&
            suggestionUrl &&
            suggestionUrl === expectedTargetUrl
        );

        if (matchesTargetUrl || (matchesTargetName && matchesTargetCompany)) {
            bestFallbackSuggestion = {
                suggestion,
                suggestionUrl,
                verifiedByUrl: matchesTargetUrl
            };
            break;
        }
    }

    if (bestFallbackSuggestion) {
        console.log("Matching target found.");
        console.log("Opening target profile...");

        await moveMouseToLocator(page, bestFallbackSuggestion.suggestion);
        await page.waitForTimeout(250 + Math.floor(Math.random() * 450));
        await clickLikeHuman(bestFallbackSuggestion.suggestion, page);
        await waitForProfileToLoad(
            page,
            bestFallbackSuggestion.verifiedByUrl ? expectedTargetUrl : ""
        );
        return;
    }

    throw new Error("Target not found in suggestions.");
}

async function runSearchPipeline(page) {
    const target = loadTargetProfile();

    await openLinkedInFeed(page);
    await performInitialTargetSearchWarmup(page);

    await openTargetProfileBySearch(page, target);

    const currentTarget = loadTargetProfile();

    console.log("Scraping target profile...");
    const targetProfile = await scrapeTargetProfile(
        page,
        currentTarget
    );

    const enrichedTarget = mergeTargetProfile(
        currentTarget,
        targetProfile
    );

    saveTargetProfile(enrichedTarget);

    const connectionsUrl = await openConnections(page);

    await waitForConnectionsPage(page, connectionsUrl);
    console.log("Target connections opened.");

    await applyConnectionFilters(page, enrichedTarget);
    console.log("Starting mutual collection.");
    return page;
}

async function scrapeTargetProfile(page, target) {
    return scrapeProfile(page, target);
}

module.exports = runSearchPipeline;
module.exports.getTargetCompany = getTargetCompany;
module.exports.scrapeTargetProfile = scrapeTargetProfile;
