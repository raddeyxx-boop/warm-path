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
        evaluate: async () => {
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
        searchInputActive: true
    };
    const released = {
        activeElement: "h1",
        searchInputActive: false
    };

    const events = [];
    await releaseLinkedInSearchFocus(
        focusPage([active, released], events),
        async () => events.push("natural-profile-interaction")
    );
    assert.deepStrictEqual(events, [
        "inspect:0",
        "natural-profile-interaction",
        "inspect:1"
    ]);

    const alreadyReleasedEvents = [];
    await releaseLinkedInSearchFocus(
        focusPage([released, released], alreadyReleasedEvents),
        async () => alreadyReleasedEvents.push("unexpected-interaction")
    );
    assert.deepStrictEqual(alreadyReleasedEvents, ["inspect:0", "inspect:1"]);

    await assert.rejects(
        () => releaseLinkedInSearchFocus(
            focusPage([active, active], []),
            async () => {}
        ),
        /SEARCH_FOCUS_NOT_RELEASED/
    );
    await assert.rejects(
        () => assertLinkedInSearchFocusReleased(focusPage([active], [])),
        /SEARCH_FOCUS_NOT_RELEASED/
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
    assert.match(targetOpening, /getLinkedInProfileReadingTarget/);

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
    assert.match(mutualOpening, /getLinkedInProfileReadingTarget/);

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
        /\.blur\(|keyboard\.press\(["'](?:Escape|Tab)["']\)|page\.goto\(|page\.reload\(|mouse\.click\(/
    );

    console.log("LinkedIn search focus lifecycle tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
