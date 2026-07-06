async function extractAbout(page) {
    try {
        return await page.evaluate(() => {
            const clean = value => (value || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            const section = [...document.querySelectorAll("main section")]
                .find(candidate => /^About$/i.test(clean(
                    candidate.querySelector("h2, h3")?.innerText ||
                    candidate.querySelector("[aria-hidden='true']")?.innerText
                )));

            if (!section) {
                return "";
            }

            const clone = section.cloneNode(true);

            clone.querySelectorAll("h1, h2, h3, button, svg, img").forEach(element => {
                element.remove();
            });

            return clean((clone.innerText || "")
                .split(/\n+/)
                .map(clean)
                .filter(Boolean)
                .join(" ")
                .replace(/\bsee more\b|\bshow less\b|\u2026\s*more/ig, "")
                .replace(/([.!?:])([A-Z])/g, "$1 $2")
                .replace(/([a-z])I([’']m)/g, "$1 I$2"));
        });
    } catch (err) {
        return "";
    }
}

module.exports = {
    extractAbout
};
