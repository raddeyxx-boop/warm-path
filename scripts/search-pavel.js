const fs = require("fs");
const path = require("path");

function getTarget() {
    return JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "../data/target.json"),
            "utf8"
        )
    );
}
async function openFilters(page) {

    console.log("Opening filters...");

    const allFilters = page.getByRole("button", {
        name: /all filters/i
    });

    await allFilters.waitFor({
        state: "visible",
        timeout: 10000
    });

    await allFilters.click();

    await page.waitForTimeout(2000);

    console.log("Filters opened.");
}

async function selectCompany(page, company) {

    console.log("Selecting:", company);

    const checkbox = page.locator(
        `div[role="checkbox"][aria-label="${company}"]`
    );

    console.log("Count:", await checkbox.count());

    if (await checkbox.count() > 0) {
        console.log("Found checkbox");

        await checkbox.first().highlight();

        await page.waitForTimeout(3000);

        await checkbox.first().click({ force: true });

        console.log("Clicked");
    } else {
        console.log("Checkbox NOT found");
    }
}
async function showResults(page) {

    console.log("Clicking Show results...");

    const link = page.locator(
        'a:has(span:text-is("Show results"))'
    );

console.log("Found:", await link.count());
console.log(await link.evaluate(el => el.outerHTML));
    await link.highlight();

    await page.waitForTimeout(1000);

    await link.click({
        force: true
    });

    console.log("Show results clicked.");

    await page.waitForLoadState("domcontentloaded");

    await page.waitForTimeout(3000);
}

async function selectSchool(page, school) {

    console.log("Selecting school:", school);

    const heading = page.locator("h2", {
        hasText: "Schools"
    });

    await heading.scrollIntoViewIfNeeded();

    await page.waitForTimeout(1000);

    const schoolName = page.locator("p", {
        hasText: school
    }).first();

    await schoolName.click();

    await page.waitForTimeout(1000);

    console.log("School selected.");
}

async function runSearchPipeline(page) {
    const target = getTarget();

    // Open LinkedIn feed
    await page.goto(
        "https://www.linkedin.com/feed/",
        {
            waitUntil: "domcontentloaded"
        }
    );

    await page.waitForTimeout(5000);

    const searchBox = page.locator(
        'input[placeholder*="Search"]'
    );

    await searchBox.waitFor({
        state: "visible",
        timeout: 15000
    });

    console.log("Search box found!");

  // Move the mouse to the search box
const box = await searchBox.boundingBox();

if (!box) {
    throw new Error("Search box position could not be determined.");
}

console.log("Moving mouse...");

await page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2,
    {
        steps: 20
    }
);

console.log("Mouse moved.");

// Click the search box
await searchBox.click();

// Clear existing text
await searchBox.fill("");
    // Small pause before typing
    await page.waitForTimeout(700);

    // Type the target name with variable delays
    for (const char of target.name) {

        await page.keyboard.type(char);

        const delay =
            120 + Math.floor(Math.random() * 160);

        await page.waitForTimeout(delay);
    }
// Wait for the search suggestions
await page.waitForSelector('[role="listbox"]', {
    timeout: 10000
});

console.log("Suggestions appeared.");

// Get all suggestion links
const suggestions = page.locator('[role="listbox"] a');

const count = await suggestions.count();

let found = false;

for (let i = 0; i < count; i++) {

    const suggestion = suggestions.nth(i);

    const text = await suggestion.innerText();

    console.log(text);

    const lower = text.toLowerCase();

    if (
        lower.includes(target.name.toLowerCase()) &&
        lower.includes(target.company.toLowerCase())
    ) {

        console.log("Matching target found.");

const suggestionBox = await suggestion.boundingBox();

if (suggestionBox) {

    await page.mouse.move(
        suggestionBox.x + suggestionBox.width / 2,
        suggestionBox.y + suggestionBox.height / 2,
        {
            steps: 30 + Math.floor(Math.random() * 20)
        }
    );

    await page.waitForTimeout(
        250 + Math.floor(Math.random() * 450)
    );
}

await suggestion.click({
    delay: 80 + Math.floor(Math.random() * 120)
});
        found = true;

        break;
    }
}

if (!found) {
    throw new Error("Target not found in suggestions.");
}



// Wait until the profile URL is loaded
await page.waitForURL(/linkedin\.com\/in\//, {
    timeout: 15000
});

// Give the profile time to render
await page.waitForTimeout(5000);

console.log("Profile opened:");
console.log(page.url());
console.log("Looking for Connections...");

console.log("Looking for 500+ connections...");

const links = page.locator("a");

const linkCount = await links.count();

let clicked = false;

for (let i = 0; i < linkCount; i++) {

    const link = links.nth(i);

    const text = (await link.innerText()).trim();

    if (text.toLowerCase().includes("connections")) {

        console.log("Found:", text);

        await link.click();

        clicked = true;

        break;
    }
}

if (!clicked) {
    throw new Error("Connections link not found.");
}

await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(3000);

console.log("Connections opened:");
console.log(page.url());

console.log("Preparing connection filters...");

console.log("Preparing connection filters...");

await openFilters(page);
console.log("Target object:", target);
console.log("Company:", target.company);
console.log("Company value =", JSON.stringify(target.company));

await selectCompany(page, target.company);

await page.waitForTimeout(1000);

await showResults(page);

return page;
}

module.exports = runSearchPipeline;