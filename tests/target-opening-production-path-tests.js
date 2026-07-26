const assert = require("assert");
const fs = require("fs");
const path = require("path");
const searchPipeline = require("../scripts/search-pavel");

async function captureLogs(action) {
    const originalLog = console.log;
    const logs = [];
    console.log = (...values) => logs.push(values.map(value =>
        typeof value === "string" ? value : JSON.stringify(value)
    ).join(" "));
    try {
        await action();
        return logs;
    } finally {
        console.log = originalLog;
    }
}

async function run() {
    const linkedinUrl = "https://www.linkedin.com/in/Ali-elsheik";
    const page = {};
    let searchCalls = 0;

    const logs = await captureLogs(() => searchPipeline(page, {
        target: {
            name: "Ali elsheik",
            linkedin_url: linkedinUrl
        },
        openLinkedInFeed: async () => {},
        performInitialTargetSearchWarmup: async () => {},
        openTargetProfileBySearch: async (_page, target) => {
            searchCalls += 1;
            assert.strictEqual(target.linkedin_url, linkedinUrl);
        },
        stopAfterTargetOpening: true
    }));

    assert.strictEqual(searchCalls, 1);
    assert.ok(logs.includes("Target opening strategy: SEARCH_BY_NAME"));

    const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "search-pavel.js"), "utf8");
    const pipelineBody = source.match(/async function runSearchPipeline\(page, testOverrides = \{\}\) \{([\s\S]*?)\n\}/)?.[1] || "";
    assert.match(pipelineBody, /openTargetProfileBySearch \|\| openTargetProfileBySearch\)\(page, target\)/);
    assert.doesNotMatch(pipelineBody, /page\.goto\(validatedUrl/);

    let missingUrlSearchCalls = 0;
    await searchPipeline(page, {
        target: { name: "Ali elsheik", linkedin_url: "", url: "" },
        openLinkedInFeed: async () => {},
        performInitialTargetSearchWarmup: async () => {},
        openTargetProfileBySearch: async (_page, target) => {
            missingUrlSearchCalls += 1;
            assert.strictEqual(target.name, "Ali elsheik");
        },
        stopAfterTargetOpening: true
    });
    assert.strictEqual(missingUrlSearchCalls, 1);

    console.log("Production search-first target-opening path tests passed.");
    logs.forEach(line => console.log(line));
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
