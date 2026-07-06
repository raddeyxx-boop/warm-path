const { cleanText } = require("./dom-utils");

async function extractHeader(page) {
    try {
        return await page.evaluate(() => {
            const clean = value => (value || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            const getLines = element => (element?.innerText || "")
                .split(/\n+/)
                .map(clean)
                .filter(Boolean);

            const firstText = (selectors, root = document) => {
                for (const selector of selectors) {
                    const element = root.querySelector(selector);
                    const text = clean(element?.innerText || element?.textContent);

                    if (text) {
                        return text;
                    }
                }

                return "";
            };

            const h1 = document.querySelector("main h1, h1");
            const headerSection =
                h1?.closest("section") ||
                [...document.querySelectorAll("main section")]
                    .find(section => section.getAttribute("componentkey")?.toLowerCase().includes("topcard")) ||
                document.querySelector("main section") ||
                document.querySelector("main");

            const name = clean(
                h1?.innerText ||
                h1?.textContent ||
                headerSection?.querySelector("h2")?.innerText ||
                headerSection?.querySelector("a[href*='/in/']")?.innerText
            );
            const lines = getLines(headerSection);
            const companyElement = headerSection?.querySelector(
                "a[href*='/company/'], a[data-field='experience_company_logo'], [aria-label*='Current company']"
            );
            const schoolElement = headerSection?.querySelector(
                "a[href*='/school/'], [aria-label*='Education']"
            );
            let currentCompany = clean(companyElement?.innerText || companyElement?.textContent);
            let school = clean(schoolElement?.innerText || schoolElement?.textContent);
            const contactIndex = lines.findIndex(line => /^contact info$/i.test(line));

            if (!currentCompany && contactIndex >= 0) {
                currentCompany = lines.slice(contactIndex + 1).find(line =>
                    !/^(connect|message|follow)$/i.test(line) &&
                    !/\bmutual connection\b/i.test(line)
                ) || "";
            }

            if (!school && contactIndex >= 0) {
                const afterContact = lines.slice(contactIndex + 1).filter(line =>
                    !/^(connect|message|follow)$/i.test(line) &&
                    !/\bmutual connection\b/i.test(line)
                );
                school = afterContact[1] || "";
            }

            let headline = firstText([
                ".pv-text-details__left-panel .text-body-medium",
                ".text-body-medium.break-words",
                ".text-body-medium"
            ], headerSection);

            if (!headline || headline === name) {
                headline = lines.find(line => {
                    if (line === name || line === currentCompany || line === school) {
                        return false;
                    }

                    return !/^(he\/him|she\/her|they\/them|contact info|connect|message|follow)$/i.test(line) &&
                        !/^·/.test(line) &&
                        !/\b(mutual connection|followers?|connections?)\b/i.test(line) &&
                        !/^\w[\w\s,.'-]+,\s*\w/i.test(line) &&
                        line.length <= 180;
                }) || "";
            }

            let location = firstText([
                ".pv-text-details__left-panel span.text-body-small.inline",
                ".pv-text-details__left-panel span.text-body-small",
                ".text-body-small.inline"
            ], headerSection);

            if (!location) {
                location = lines.find(line =>
                    line !== name &&
                    line !== headline &&
                    /(^|\b)(india|united states|usa|united kingdom|canada|germany|sweden|australia|singapore)\b/i.test(line)
                ) || "";
            }

            const headerText = headerSection?.innerText || "";
            const activitySection = [...document.querySelectorAll("main section")]
                .find(section => /^Activity\b/i.test(clean(section.querySelector("h2, h3")?.innerText || "")));
            const activityText = activitySection?.innerText || "";
            const followersMatch = (headerText + "\n" + activityText).match(/([\d,]+)\s+followers/i);
            const connectionsMatch = headerText.match(/([\d,]+\+?)\s+connections/i);

            return {
                name,
                headline,
                current_company: currentCompany,
                position: headline,
                location,
                followers: followersMatch ? followersMatch[1].replace(/,/g, "") : "",
                connections: connectionsMatch ? connectionsMatch[1].replace(/,/g, "") : ""
            };
        });
    } catch (err) {
        return {
            name: "",
            headline: "",
            current_company: "",
            position: "",
            location: "",
            followers: "",
            connections: ""
        };
    }
}

async function extractName(page) {
    return cleanText((await extractHeader(page)).name);
}

async function extractHeadline(page) {
    return cleanText((await extractHeader(page)).headline);
}

async function extractCompany(page, headline) {
    const header = await extractHeader(page);

    if (header.current_company) {
        return header.current_company;
    }

    const match = cleanText(headline).match(/\bat\s+(.+)$/i);
    return match ? cleanText(match[1]) : "";
}

async function extractLocation(page) {
    return cleanText((await extractHeader(page)).location);
}

module.exports = {
    extractHeader,
    extractName,
    extractHeadline,
    extractCompany,
    extractLocation
};
