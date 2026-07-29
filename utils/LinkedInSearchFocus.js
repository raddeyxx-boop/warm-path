const LINKEDIN_SEARCH_INPUT_SELECTOR = 'input[placeholder*="Search" i]';

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
            searchInputActive: Boolean(active?.matches?.(selector)),
            modalOpen: [...document.querySelectorAll('[role="dialog"], dialog')].some(element => {
                const style = window.getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return element.getAttribute("aria-hidden") !== "true" &&
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    box.width > 0 &&
                    box.height > 0;
            })
        };
    }, LINKEDIN_SEARCH_INPUT_SELECTOR);
}

async function logLinkedInSearchFocus(page, stage) {
    const state = await inspectLinkedInSearchFocus(page);
    console.log(`[SEARCH_FOCUS] stage=${stage}`);
    console.log(`[SEARCH_FOCUS] active_element=${state.activeElement}`);
    console.log(`[SEARCH_FOCUS] search_input_active=${state.searchInputActive}`);
    console.log(`[SEARCH_FOCUS] modal_open=${state.modalOpen}`);
    return state;
}

function assertCleanProfileFocusState(state) {
    if (state.searchInputActive) {
        throw new Error(
            "SEARCH_FOCUS_NOT_RELEASED: LinkedIn search input is still active before profile scraping."
        );
    }
    if (state.modalOpen) {
        throw new Error(
            "PROFILE_MODAL_OPEN: A LinkedIn modal is open before profile scraping."
        );
    }
}

async function releaseLinkedInSearchFocus(page) {
    const afterSubmit = await logLinkedInSearchFocus(page, "after_submit");
    if (afterSubmit.searchInputActive) {
        await page.evaluate(selector => {
            const active = document.activeElement;
            if (active instanceof HTMLElement && active.matches(selector)) {
                active.blur();
            }
        }, LINKEDIN_SEARCH_INPUT_SELECTOR);
    }

    const beforeScraping = await logLinkedInSearchFocus(page, "before_scraping");
    assertCleanProfileFocusState(beforeScraping);
}

async function assertLinkedInSearchFocusReleased(page) {
    const state = await logLinkedInSearchFocus(page, "before_scraping");
    assertCleanProfileFocusState(state);
}

module.exports = {
    LINKEDIN_SEARCH_INPUT_SELECTOR,
    inspectLinkedInSearchFocus,
    logLinkedInSearchFocus,
    releaseLinkedInSearchFocus,
    assertLinkedInSearchFocusReleased
};
