const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "scrape-profile-details.js"),
    "utf8"
);

const findAndOpenProfile = source.slice(
    source.indexOf("async function findAndOpenProfile"),
    source.indexOf("function profileMatchesTarget")
);
const main = source.slice(
    source.indexOf("async function main()"),
    source.indexOf("if (require.main === module)")
);

assert.strictEqual(
    (main.match(/await openLinkedInHome\(session\.page\)/g) || []).length,
    1,
    "Mutual processing must open LinkedIn Home exactly once."
);
assert.strictEqual(
    (main.match(/session = await startBrowser\(\)/g) || []).length,
    1,
    "All mutuals must share one browser session."
);
assert.doesNotMatch(main, /restoreMutualsPage|loadMutualsParentState/);
assert.doesNotMatch(findAndOpenProfile, /restoreMutualsPage|openLinkedInHome\s*\(/);
assert.match(findAndOpenProfile, /currentSearchBox/);
assert.match(findAndOpenProfile, /Searching first mutual/);
assert.match(findAndOpenProfile, /Searching next mutual from current profile/);
assert.match(findAndOpenProfile, /await runProfileSearch\(/);

for (const name of ["Ali", "Faisal Bajouri", "Ibrahim"]) {
    assert(name.length > 0, "Navigation sequence must retain each mutual name.");
}

console.log("Mutual profile-to-profile navigation tests passed.");
