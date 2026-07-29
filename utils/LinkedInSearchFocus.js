const LINKEDIN_SEARCH_INPUT_SELECTOR = 'input[placeholder*="Search" i]';
const LINKEDIN_PROFILE_READING_TARGET_SELECTOR = [
    "h1",
    'main section[componentkey*="topcard" i] h2',
    'main section[componentkey*="topcard" i] a[href*="/in/"]'
].join(", ");

async function inspectLinkedInSearchFocus(page) {
    return page.evaluate(selector => {
        const active = document.activeElement;
        const identifier = active
            ? [
                active.tagName.toLowerCase(),
                active.getAttribute("role") ? `role=${active.getAttribute("role")}` : "",
                active.id ? `#${active.id}` : "",
                active.getAttribute("aria-label") ? `aria-label=${active.getAttribute("aria-label")}` : ""
            ].filter(Boolean).join("/")
            : "none";

        return {
            activeElement: identifier,
            searchInputActive: Boolean(active?.matches?.(selector))
        };
    }, LINKEDIN_SEARCH_INPUT_SELECTOR);
}

async function logLinkedInSearchFocus(page, stage) {
    const state = await inspectLinkedInSearchFocus(page);
    console.log(`[SEARCH_FOCUS] stage=${stage}`);
    console.log(`[SEARCH_FOCUS] active_element=${state.activeElement}`);
    console.log(`[SEARCH_FOCUS] search_input_active=${state.searchInputActive}`);
    return state;
}

async function releaseLinkedInSearchFocus(page, naturalProfileInteraction) {
    const afterSubmit = await logLinkedInSearchFocus(page, "after_submit");
    if (afterSubmit.searchInputActive) {
        await naturalProfileInteraction();
    }

    const beforeScraping = await logLinkedInSearchFocus(page, "before_scraping");
    if (beforeScraping.searchInputActive) {
        throw new Error(
            "SEARCH_FOCUS_NOT_RELEASED: LinkedIn search input is still active before profile scraping."
        );
    }
}

async function assertLinkedInSearchFocusReleased(page) {
    const state = await logLinkedInSearchFocus(page, "before_scraping");
    if (state.searchInputActive) {
        throw new Error(
            "SEARCH_FOCUS_NOT_RELEASED: LinkedIn search input is still active before profile scraping."
        );
    }
}

async function getLinkedInProfileReadingTarget(page, timeout) {
    const target = page.locator(LINKEDIN_PROFILE_READING_TARGET_SELECTOR).first();
    await target.waitFor({ state: "visible", timeout });
    return target;
}

module.exports = {
    LINKEDIN_SEARCH_INPUT_SELECTOR,
    LINKEDIN_PROFILE_READING_TARGET_SELECTOR,
    inspectLinkedInSearchFocus,
    logLinkedInSearchFocus,
    releaseLinkedInSearchFocus,
    assertLinkedInSearchFocusReleased,
    getLinkedInProfileReadingTarget
};
