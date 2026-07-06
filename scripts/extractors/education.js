const { cleanText } = require("./dom-utils");

async function extractEducation(page) {
    try {
        const education = await page.evaluate(() => {
            const clean = value => (value || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const linesFrom = element => (element?.innerText || "")
                .split(/\n+/)
                .map(clean)
                .filter(Boolean);
            const section = [...document.querySelectorAll("main section")]
                .find(candidate => /^Education$/i.test(clean(candidate.querySelector("h2, h3")?.innerText)));

            if (!section) {
                return [];
            }

            const schoolLinks = [...section.querySelectorAll("a[href*='/school/']")]
                .map(link => linesFrom(link))
                .filter(lines => lines.length);
            const blocks = schoolLinks.length ? schoolLinks : [linesFrom(section)];

            return blocks.map(lines => {
                const filtered = lines.filter(line =>
                    !/^education$/i.test(line) &&
                    !/^show all/i.test(line) &&
                    !/^(grade|activities and societies):/i.test(line)
                );

                return {
                    school: filtered[0] || "",
                    degree: filtered.find((line, index) =>
                        index > 0 &&
                        !/\b\d{4}\b/.test(line) &&
                        !/^[A-Za-z]{3}\s+\d{4}/.test(line)
                    ) || ""
                };
            });
        });

        return education
            .map(item => ({
                school: cleanText(item.school),
                degree: cleanText(item.degree)
            }))
            .filter(item => item.school || item.degree);
    } catch (err) {
        return [];
    }
}

module.exports = {
    extractEducation
};
