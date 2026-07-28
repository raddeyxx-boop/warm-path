const assert = require("assert");
const {
    normalizeLinkedInProfilePath,
    selectTargetFromSuggestions,
    openTargetFromPeopleResults,
    typeTargetNameIntoSearch
} = require("../scripts/search-pavel");

function locatorList(items) {
    return {
        count: async () => items.length,
        nth: index => items[index],
        first: () => items[0]
    };
}

function suggestion(page, { text, href }) {
    return {
        isVisible: async () => true,
        innerText: async () => text,
        getAttribute: async name => name === "href" ? href : null,
        locator: () => locatorList([]),
        boundingBox: async () => ({ x: 100, y: 100, width: 220, height: 48 }),
        page: () => page,
        waitFor: async () => {},
        hover: async () => {},
        evaluate: async () => false,
        scrollIntoViewIfNeeded: async () => { page.scrolls += 1; },
        click: async options => {
            assert.strictEqual(options.timeout, 7000);
            assert.ok(options.delay >= 70 && options.delay <= 179);
            page.clicks += 1;
            page.currentUrl = new URL(href, "https://www.linkedin.com").href;
        }
    };
}

function mockPage() {
    return {
        clicks: 0,
        scrolls: 0,
        currentUrl: "https://www.linkedin.com/feed/",
        mouse: { move: async () => {} },
        waitForTimeout: async () => {},
        viewportSize: () => ({ width: 1200, height: 700 }),
        url() { return this.currentUrl; },
        waitForURL: async function (predicate) {
            assert.strictEqual(predicate(new URL(this.currentUrl)), true);
        },
        locator: selector => {
            assert.strictEqual(selector, "main");
            return { first: () => ({ waitFor: async () => {} }) };
        }
    };
}

async function run() {
    assert.strictEqual(
        normalizeLinkedInProfilePath("https://www.linkedin.com/in/gowri-n-s/?miniProfileUrn=abc"),
        "/in/gowri-n-s"
    );
    assert.strictEqual(normalizeLinkedInProfilePath("/in/gowri-n-s/"), "/in/gowri-n-s");

    for (const testCase of [
        {
            text: "Gowri N S\nSoftware Engineer at Indpro AB",
            href: "https://www.linkedin.com/in/gowri-n-s/?miniProfileUrn=abc"
        },
        { text: "Gowri N S", href: "/in/gowri-n-s/" },
        { text: "Gowri Narayan", href: "/in/gowri-n-s" }
    ]) {
        const page = mockPage();
        const nonMatch = suggestion(page, { text: "Someone Else", href: "/in/someone-else" });
        const exact = suggestion(page, testCase);
        const matched = await selectTargetFromSuggestions(page, {
            name: "Gowri N S",
            linkedin_url: "https://www.linkedin.com/in/gowri-n-s"
        }, locatorList([nonMatch, exact, suggestion(page, { text: "Unread", href: "/in/unread" })]));
        assert.strictEqual(matched, true);
        assert.strictEqual(page.clicks, 1);
        assert.strictEqual(page.scrolls, 2);
    }

    const wrongUrlPage = mockPage();
    const wrongUrlMatched = await selectTargetFromSuggestions(wrongUrlPage, {
        name: "Gowri N S",
        linkedin_url: "https://www.linkedin.com/in/gowri-n-s"
    }, locatorList([suggestion(wrongUrlPage, { text: "Gowri N S", href: "/in/another-gowri" })]));
    assert.strictEqual(wrongUrlMatched, false);
    assert.strictEqual(wrongUrlPage.clicks, 0);

    const namePage = mockPage();
    const nameMatched = await selectTargetFromSuggestions(namePage, {
        name: "Gowri N. S",
        linkedin_url: ""
    }, locatorList([suggestion(namePage, { text: "Gowri N S\nEngineer", href: "/in/gowri-n-s" })]));
    assert.strictEqual(nameMatched, true);
    assert.strictEqual(namePage.clicks, 1);

    const resultsPage = mockPage();
    const resultAnchor = suggestion(resultsPage, { text: "Gowri N S", href: "/in/gowri-n-s/?trk=people" });
    resultsPage.waitForURL = async predicate => {
        assert.strictEqual(predicate(new URL(resultsPage.currentUrl)), true);
    };
    resultsPage.locator = selector => {
        if (selector === "main") {
            return { first: () => ({ waitFor: async () => {} }) };
        }
        assert.strictEqual(selector, 'main a[href*="/in/"]');
        const list = locatorList([resultAnchor]);
        list.first = () => ({ waitFor: async () => {} });
        return list;
    };
    let enterPresses = 0;
    const resultsSearchBox = { press: async key => {
        assert.strictEqual(key, "Enter");
        enterPresses += 1;
        resultsPage.currentUrl = "https://www.linkedin.com/search/results/all/?keywords=Gowri%20N%20S";
    } };
    assert.strictEqual(await openTargetFromPeopleResults(resultsPage, {
        name: "Gowri N S",
        linkedin_url: "https://www.linkedin.com/in/gowri-n-s"
    }, resultsSearchBox), true);
    assert.strictEqual(resultsPage.clicks, 1);
    assert.strictEqual(enterPresses, 1);

    const typingPage = { waitForTimeout: async () => {} };
    const pressed = [];
    let typedValue = "";
    const typingBox = {
        waitFor: async () => {},
        scrollIntoViewIfNeeded: async () => {},
        click: async () => {},
        press: async key => {
            pressed.push(key);
            if (key === "Backspace") typedValue = "";
        },
        page: () => typingPage,
        inputValue: async () => typedValue
    };
    let humanTypeCalls = 0;
    await typeTargetNameIntoSearch(typingPage, typingBox, "Gowri N S", async (_page, value) => {
        humanTypeCalls += 1;
        typedValue = value;
    });
    assert.strictEqual(humanTypeCalls, 1);
    assert.deepStrictEqual(pressed, [process.platform === "darwin" ? "Meta+A" : "Control+A", "Backspace"]);

    console.log("LinkedIn suggestion selection tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
