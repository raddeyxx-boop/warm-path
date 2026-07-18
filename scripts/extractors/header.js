const { cleanText } = require("./dom-utils");
const { normalizeNumericField } = require("../../utils/NumericNormalizer");

function escapeRegExp(value) {
    return cleanText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function derivePositionFromHeadline(headline, currentCompany = "") {
    const cleanedHeadline = cleanText(headline);
    const company = cleanText(currentCompany);

    if (!cleanedHeadline) {
        return "";
    }

    const primaryHeadline = cleanedHeadline.split(/\s+[|•]\s+/)[0].trim();

    if (company) {
        const companyMatch = primaryHeadline.match(
            new RegExp(`^(.+?)\\s+(?:at|@)\\s+${escapeRegExp(company)}\\b`, "i")
        );

        if (companyMatch) {
            return cleanText(companyMatch[1]);
        }
    }

    const genericMatch = primaryHeadline.match(/^(.+?)\s+(?:at|@)\s+.+$/i);

    if (genericMatch) {
        return cleanText(genericMatch[1]);
    }

    return primaryHeadline || cleanedHeadline;
}

async function extractHeader(page) {
    try {
        const header = await page.evaluate(() => {
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
            const isProfileSection = section => !!section && !section.closest("aside");
            const isHeaderNoise = line =>
                /^(he\/him|she\/her|they\/them|contact info|connect|message|follow|more)$/i.test(line) ||
                /\b(mutual connection|followers?|connections?)\b/i.test(line) ||
                /^[\u00b7•]/.test(line);
            const looksLikeLocation = line =>
                !isHeaderNoise(line) &&
                !/^open to work$/i.test(line) &&
                !/^hiring$/i.test(line) &&
                /(^|\b)(greater\s+.+\s+area|.+,\s*.+|india|united states|usa|united kingdom|canada|germany|sweden|australia|singapore|france|netherlands|ireland|area)\b/i.test(line);
            const derivePosition = (headline, company) => {
                const cleanedHeadline = clean(headline);
                const cleanedCompany = clean(company);

                if (!cleanedHeadline) {
                    return "";
                }

                const primaryHeadline = cleanedHeadline.split(/\s+[\|\u2022]\s+/)[0].trim();
                const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

                if (cleanedCompany) {
                    const companyMatch = primaryHeadline.match(
                        new RegExp(`^(.+?)\\s+(?:at|@)\\s+${escapeRegExp(cleanedCompany)}\\b`, "i")
                    );

                    if (companyMatch) {
                        return clean(companyMatch[1]);
                    }
                }

                const genericMatch = primaryHeadline.match(/^(.+?)\s+(?:at|@)\s+.+$/i);

                if (genericMatch) {
                    return clean(genericMatch[1]);
                }

                return primaryHeadline || cleanedHeadline;
            };

            const h1 = document.querySelector("main h1, h1");
            const headerSection =
                (isProfileSection(h1?.closest("section")) ? h1.closest("section") : null) ||
                [...document.querySelectorAll("main section")]
                    .filter(isProfileSection)
                    .find(section => section.getAttribute("componentkey")?.toLowerCase().includes("topcard")) ||
                [...document.querySelectorAll("main section")].find(isProfileSection) ||
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

                    return !isHeaderNoise(line) &&
                        !/^\w[\w\s,.'-]+,\s*\w/i.test(line) &&
                        line.length <= 180;
                }) || "";
            }

            let location = [
                ...headerSection.querySelectorAll(`
                    .pv-text-details__left-panel span.text-body-small.inline,
                    .pv-text-details__left-panel span.text-body-small,
                    span.text-body-small.inline,
                    span.text-body-small
                `)
            ]
                .map(element => clean(element.innerText || element.textContent))
                .find(looksLikeLocation) || "";

            if (!location) {
                location = firstText([
                    ".pv-text-details__left-panel span.text-body-small.inline",
                    ".pv-text-details__left-panel span.text-body-small",
                    ".text-body-small.inline"
                ], headerSection);
            }

            if (!looksLikeLocation(location)) {
                location = lines.find(line =>
                    line !== name &&
                    line !== headline &&
                    looksLikeLocation(line)
                ) || "";
            }

            const headerText = headerSection?.innerText || "";
            const activitySection = [...document.querySelectorAll("main section")]
                .filter(isProfileSection)
                .find(section => /^Activity\b/i.test(clean(section.querySelector("h2, h3")?.innerText || "")));
            const activityText = activitySection?.innerText || "";
            const followersMatch = (headerText + "\n" + activityText).match(/([\d,]+)\s+followers/i);
            const connectionsMatch = headerText.match(/([\d,]+\+?)\s+connections/i);

            return {
                name,
                headline,
                current_company: currentCompany,
                position: derivePosition(headline, currentCompany),
                location,
                followers: followersMatch ? followersMatch[0] : null,
                connections: connectionsMatch ? connectionsMatch[0] : null
            };
        });

        return {
            ...header,
            followers: normalizeNumericField(header.followers),
            connections: normalizeNumericField(header.connections)
        };
    } catch (err) {
        return {
            name: "",
            headline: "",
            current_company: "",
            position: "",
            location: "",
            followers: null,
            connections: null
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
    extractLocation,
    derivePositionFromHeadline
};
