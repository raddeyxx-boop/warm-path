const { cleanText, uniqueValues } = require("./dom-utils");

async function extractSkills(page) {
    try {
        const skills = await page.evaluate(() => {
            const clean = value => (value || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const section = [...document.querySelectorAll("main section")]
                .find(candidate => /^Skills(?:\s+\(\d+\))?$/i.test(clean(candidate.querySelector("h2, h3")?.innerText)));

            if (!section) {
                return [];
            }

            const listItems = [...section.querySelectorAll("li, [role='listitem']")]
                .map(item => clean(item.innerText).split(/\n+/)[0])
                .filter(Boolean);
            const lines = (section.innerText || "")
                .split(/\n+/)
                .map(clean)
                .filter(Boolean);

            if (listItems.some(item => !/\bat\s+/i.test(item))) {
                return listItems;
            }

            return lines;
        });

        return uniqueValues(skills)
            .filter(skill => !/^skills(?:\s+\(\d+\))?$/i.test(skill))
            .filter(skill => !/^show all/i.test(skill))
            .filter(skill => !/\bat\s+/i.test(skill))
            .filter(skill => !/^\d+$/.test(skill))
            .slice(0, 25);
    } catch (err) {
        return [];
    }
}

module.exports = {
    extractSkills
};
