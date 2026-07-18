const { cleanText } = require("./dom-utils");

function normalizeEducationDateKey(value) {
    return cleanText(value)
        .replace(/â€“|â€”/g, "-")
        .replace(/[–—]/g, "-")
        .match(/\b\d{4}\b/g)
        ?.join("-") || cleanText(value).toLowerCase();
}

function dedupeEducationRecords(education) {
    const seenExact = new Set();
    const seenLoose = new Map();
    const unique = [];

    for (const item of education) {
        const cleaned = {
            school: cleanText(item.school),
            degree: cleanText(item.degree),
            field_of_study: cleanText(item.field_of_study),
            dates: cleanText(item.dates),
            activities: cleanText(item.activities),
            honors: cleanText(item.honors)
        };

        if (!cleaned.school && !cleaned.degree && !cleaned.field_of_study) {
            continue;
        }

        const coreKey = [
            cleaned.school,
            cleaned.degree,
            cleaned.field_of_study
        ].join("|").toLowerCase();
        const exactKey = [
            coreKey,
            normalizeEducationDateKey(cleaned.dates)
        ].join("|");

        if (seenExact.has(exactKey)) {
            continue;
        }

        const existingIndex = seenLoose.get(coreKey);

        if (existingIndex !== undefined) {
            const existing = unique[existingIndex];
            const existingYears = normalizeEducationDateKey(existing.dates);
            const cleanedYears = normalizeEducationDateKey(cleaned.dates);

            if (!existingYears || existingYears === cleanedYears) {
                unique[existingIndex] = cleaned.dates.length > existing.dates.length
                    ? cleaned
                    : existing;
                seenExact.add(exactKey);
                continue;
            }
        }

        seenExact.add(exactKey);
        seenLoose.set(coreKey, unique.length);
        unique.push(cleaned);
    }

    return unique;
}

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
            const getHeadingText = section => clean(
                section.querySelector("h2, h3, [role='heading'], [aria-level]")?.innerText ||
                section.querySelector("[aria-hidden='true']")?.innerText
            );
            const marker = document.querySelector("#education");
            const markerSection =
                marker?.closest("section") ||
                marker?.parentElement?.querySelector("section") ||
                marker?.nextElementSibling;
            const section = [...document.querySelectorAll("main section")]
                .filter(candidate => !candidate.closest("aside"))
                .find(candidate => /^Education$/i.test(getHeadingText(candidate))) ||
                (markerSection?.matches?.("section") && !markerSection.closest("aside") ? markerSection : null);

            if (!section) {
                return [];
            }

            const isNoise = line =>
                /^education$/i.test(line) ||
                /^show all/i.test(line) ||
                /^show less$/i.test(line) ||
                /^logo$/i.test(line) ||
                /^.+\s+logo$/i.test(line) ||
                /^grade:/i.test(line);
            const schoolLinks = [...section.querySelectorAll("a[href*='/school/'], li, [role='listitem']")]
                .map(link => linesFrom(link))
                .filter(lines => lines.some(line => !isNoise(line)));
            const blocks = schoolLinks.length ? schoolLinks : [linesFrom(section)];

            return blocks.map(lines => {
                const filtered = lines.filter(line => !isNoise(line));
                const dateLine = filtered.find(line =>
                    /\b\d{4}\b/.test(line) &&
                    /(-|–|—|to|present|current|\b\d{4}\b.*\b\d{4}\b)/i.test(line)
                ) || "";
                const activities = filtered.find(line =>
                    /^activities and societies:/i.test(line)
                ) || "";
                const honors = filtered.find(line =>
                    /^(honors?|awards?):/i.test(line)
                ) || "";
                const degreeLine = filtered.find((line, index) =>
                    index > 0 &&
                    line !== dateLine &&
                    !/^activities and societies:/i.test(line) &&
                    !/^(honors?|awards?):/i.test(line)
                ) || "";
                const degreeParts = degreeLine.split(",").map(clean).filter(Boolean);

                return {
                    school: filtered[0] || "",
                    degree: degreeParts[0] || degreeLine,
                    field_of_study: degreeParts.slice(1).join(", "),
                    dates: dateLine,
                    activities: activities.replace(/^activities and societies:\s*/i, ""),
                    honors: honors.replace(/^(honors?|awards?):\s*/i, "")
                };
            });
        });

        return dedupeEducationRecords(education);
    } catch (err) {
        return [];
    }
}

module.exports = {
    extractEducation,
    dedupeEducationRecords
};
