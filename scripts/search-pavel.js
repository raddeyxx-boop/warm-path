const target = require("../data/target.json");

async function searchTarget(page) {


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

        await suggestion.click();

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
// TODO:
// 1. If "1st" is currently selected, deselect it.
// 2. If "3rd+" is currently selected, deselect it.
// 3. Select the "2nd" filter.
// 4. Wait for the results to refresh.

await page.waitForTimeout(3000);

return page;
}

module.exports = searchTarget;