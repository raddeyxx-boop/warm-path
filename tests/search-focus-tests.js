const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    releaseLinkedInSearchFocus,
    assertLinkedInSearchFocusReleased
} = require("../utils/LinkedInSearchFocus");

function focusPage(states, events) {
    let index = 0;
    return {
        evaluate: async action => {
            if (/\.blur\(\)/.test(action.toString())) {
                events.push("blur-search-input");
                return;
            }
            events.push(`inspect:${index}`);
            return states[Math.min(index++, states.length - 1)];
        }
    };
}

function functionBody(source, name, nextName) {
    return source.slice(
        source.indexOf(`async function ${name}`),
        source.indexOf(nextName)
    );
}

async function run() {
    const active = {
        activeElement: "input/role=combobox/aria-label=Search",
        searchInputActive: true,
        modalOpen: false
    };
    const released = {
        activeElement: "h1",
        searchInputActive: false,
        modalOpen: false
    };
    const modalOpen = {
        activeElement: "body",
        searchInputActive: false,
        modalOpen: true
    };

    const events = [];
    await releaseLinkedInSearchFocus(focusPage([active, released], events));
    assert.deepStrictEqual(events, [
        "inspect:0",
        "blur-search-input",
        "inspect:1"
    ]);

    const alreadyReleasedEvents = [];
    await releaseLinkedInSearchFocus(focusPage([released, released], alreadyReleasedEvents));
    assert.deepStrictEqual(alreadyReleasedEvents, ["inspect:0", "inspect:1"]);

    await assert.rejects(
        () => releaseLinkedInSearchFocus(focusPage([active, active], [])),
        /SEARCH_FOCUS_NOT_RELEASED/
    );
    await assert.rejects(
        () => assertLinkedInSearchFocusReleased(focusPage([active], [])),
        /SEARCH_FOCUS_NOT_RELEASED/
    );
    await assert.rejects(
        () => assertLinkedInSearchFocusReleased(focusPage([modalOpen], [])),
        /PROFILE_MODAL_OPEN/
    );

    const targetSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "search-pavel.js"),
        "utf8"
    );
    const mutualSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "scrape-profile-details.js"),
        "utf8"
    );

    const targetTyping = functionBody(
        targetSource,
        "typeTargetNameIntoSearch",
        "async function typeLikeHuman"
    );
    assert.ok(targetTyping.indexOf('"before_typing"') < targetTyping.indexOf("await humanTyper("));
    assert.ok(targetTyping.indexOf("await humanTyper(") < targetTyping.indexOf('"after_typing"'));

    const targetOpening = functionBody(
        targetSource,
        "openTargetProfileBySearch",
        "async function runSearchPipeline"
    );
    assert.ok(targetOpening.indexOf("openTargetFromPeopleResults") <
        targetOpening.indexOf("releaseLinkedInSearchFocus"));
    assert.ok(targetOpening.indexOf("releaseLinkedInSearchFocus") <
        targetOpening.indexOf("[TARGET] Target profile loaded"));
    assert.doesNotMatch(targetOpening, /profileHeading|naturalProfileInteraction/);

    const mutualSearch = functionBody(
        mutualSource,
        "runProfileSearch",
        "async function searchProfile"
    );
    assert.ok(mutualSearch.indexOf('"before_typing"') < mutualSearch.indexOf("await typeLikeHuman("));
    assert.ok(mutualSearch.indexOf("await typeLikeHuman(") < mutualSearch.indexOf('"after_typing"'));

    const mutualOpening = functionBody(
        mutualSource,
        "openVerifiedProfile",
        "async function getSuggestionVerification"
    );
    assert.ok(mutualOpening.indexOf("[LINKEDIN_SEARCH] Search submitted") <
        mutualOpening.indexOf("[LINKEDIN_SEARCH] Navigation/results detected"));
    assert.ok(mutualOpening.indexOf("[LINKEDIN_SEARCH] Navigation/results detected") <
        mutualOpening.indexOf("releaseLinkedInSearchFocus"));
    assert.doesNotMatch(mutualOpening, /profileHeading|naturalProfileInteraction/);

    const scraper = functionBody(
        mutualSource,
        "scrapeProfile",
        "async function findAndOpenProfile"
    );
    assert.ok(scraper.indexOf("assertLinkedInSearchFocusReleased") <
        scraper.indexOf("await waitForProfileContent"));

    assert.match(targetSource, /Character delay range: 70-149ms \| 120-279ms/);
    assert.match(mutualSource, /HUMAN_BEHAVIOR_CONFIG\.minSearchDelayMs/);
    assert.doesNotMatch(
        `${targetOpening}\n${mutualOpening}`,
        /keyboard\.press\(["'](?:Escape|Tab)["']\)|page\.goto\(|page\.reload\(|mouse\.click\(/
    );
    assert.match(targetOpening, /await releaseLinkedInSearchFocus\(page\);/);
    assert.match(mutualOpening, /await releaseLinkedInSearchFocus\(page\);/);

    console.log("LinkedIn search focus lifecycle tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
