function cleanText(value) {
    return (value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function dedupeExperience(items) {
    const seen = new Set();

    return items
        .map(item => ({
            company: cleanText(item.company),
            title: cleanText(item.title),
            duration: cleanText(item.duration)
        }))
        .filter(item => item.company && item.title)
        .filter(item => {
            const key = [
                item.company.toLowerCase(),
                item.title.toLowerCase(),
                item.duration.toLowerCase()
            ].join("|");

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
}

async function extractExperience(page) {
    try {
        const experience = await page.evaluate(() => {
            const clean = value => (value || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const linesFrom = element => (element?.innerText || "")
                .split(/\n+/)
                .map(clean)
                .filter(Boolean)
                .filter(line => !/^Experience$/i.test(line))
                .filter(line => !/^Show all/i.test(line))
                .filter(line => !/\band\s+\+\d+\s+skills?\b/i.test(line));
            const separatorPattern = /\s+[\u00b7\u2022]\s+/;
            const hasSeparator = value => separatorPattern.test(value);
            const hasDuration = value => /\b(present|current|\d{4})\b/i.test(value) &&
                /(-|\u2013|\u2014|to|\bpresent\b|\bcurrent\b)/i.test(value);
            const hasWorkType = value =>
                /\b(full-time|part-time|self-employed|contract|freelance|internship|temporary)\b/i.test(value);
            const looksLikeLocation = value =>
                /,\s*.+/.test(value) &&
                /\b(india|united states|usa|united kingdom|canada|germany|sweden|australia|singapore|remote|on-site|hybrid)\b/i.test(value);
            const isNoise = value =>
                !value ||
                /^Experience$/i.test(value) ||
                /^Show all/i.test(value) ||
                /^Top skills$/i.test(value) ||
                /^logo$/i.test(value) ||
                /^… more$/i.test(value) ||
                value.startsWith("•") ||
                /\band\s+\+\d+\s+skills?\b/i.test(value);
            const cleanCompany = value => clean(value)
                .split(separatorPattern)[0]
                .replace(/\s+(full-time|part-time|self-employed|contract|freelance|internship|temporary)$/i, "");
            const cleanDuration = value => clean(value).split(separatorPattern)[0];

            const section = [...document.querySelectorAll("main section")]
                .find(candidate => {
                    const heading = clean(candidate.querySelector("h2, h3")?.innerText);

                    return /^Experience$/i.test(heading) || !!candidate.querySelector("#experience");
                });

            if (!section) {
                return [];
            }

            const parseRoleLines = lines => {
                const filtered = lines.filter(line => !isNoise(line));
                const companyIndex = filtered.findIndex(line =>
                    hasSeparator(line) &&
                    !hasDuration(line)
                );
                const durationIndex = filtered.findIndex(hasDuration);

                if (companyIndex < 0) {
                    return null;
                }

                const title = filtered.slice(0, companyIndex).reverse().find(line =>
                    !hasDuration(line) &&
                    !hasWorkType(line) &&
                    !looksLikeLocation(line)
                ) || filtered.find((line, index) =>
                    index !== companyIndex &&
                    index !== durationIndex &&
                    !hasDuration(line) &&
                    !hasWorkType(line) &&
                    !looksLikeLocation(line)
                ) || "";

                if (!title) {
                    return null;
                }

                return {
                    company: cleanCompany(filtered[companyIndex]),
                    title,
                    duration: durationIndex >= 0 ? cleanDuration(filtered[durationIndex]) : ""
                };
            };

            const results = [];

            // Text-bearing company anchors are the most reliable visible card boundary on
            // LinkedIn profile pages. Empty logo anchors are ignored.
            for (const link of section.querySelectorAll("a[href*='/company/']")) {
                const linkLines = linesFrom(link);

                if (!linkLines.length) {
                    continue;
                }

                const role = parseRoleLines(linkLines);

                if (role) {
                    results.push(role);
                }
            }

            if (results.length) {
                return results;
            }

            // Fallback for variants where the company card is not an anchor.
            const cards = [...section.querySelectorAll("li, [role='listitem']")]
                .filter(card => {
                    const text = clean(card.innerText);

                    return hasDuration(text) && hasSeparator(text);
                })
                .filter((card, index, allCards) =>
                    !allCards.some((other, otherIndex) =>
                        otherIndex !== index &&
                        other.contains(card) &&
                        clean(other.innerText) !== clean(card.innerText)
                    )
                );

            for (const card of cards) {
                const role = parseRoleLines(linesFrom(card));

                if (role) {
                    results.push(role);
                }
            }

            return results;
        });

        return dedupeExperience(experience);
    } catch (err) {
        return [];
    }
}

async function hasExperienceSection(page) {
    try {
        return await page.evaluate(() => {
            const clean = value => (value || "").replace(/\s+/g, " ").trim();

            return [...document.querySelectorAll("main section")]
                .some(section => /^Experience$/i.test(clean(section.querySelector("h2, h3")?.innerText)) ||
                    !!section.querySelector("#experience"));
        });
    } catch (err) {
        return false;
    }
}

module.exports = {
    extractExperience,
    hasExperienceSection
};
