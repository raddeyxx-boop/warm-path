const {
    cleanDurationText,
    parseDurationRange
} = require("../../utils/DurationParser");
const {
    debugLog
} = require("../../utils/DebugLogger");
const { cleanText } = require("./dom-utils");

function cleanCompany(value) {
    return cleanText(value)
        .split(/\s+[\u00b7\u2022]\s+/)[0]
        .replace(/\s+(?:full-time|part-time|contract|freelance|internship|temporary|apprenticeship|self-employed)$/i, "")
        .trim();
}

function normalizeExperienceKey(value) {
    return cleanText(value).toLowerCase();
}

function cleanExperienceDurationText(value) {
    if (typeof cleanDurationText === "function") {
        return cleanDurationText(value);
    }

    return cleanText(value)
        .split(/\s+[\u00b7\u2022]\s+/)[0]
        .trim();
}

function parseExperienceDuration(item) {
    if (item.duration && typeof item.duration === "object") {
        return item.duration;
    }

    const originalDuration = cleanText(item.duration_text || "");
    const cleanedDuration = cleanExperienceDurationText(originalDuration);
    const parserInput = cleanedDuration || originalDuration;
    const parsed = parseDurationRange(parserInput);

    debugLog("experience-duration", "parsed experience duration", {
        company: cleanCompany(item.company),
        title: cleanText(item.title),
        original_duration_string: originalDuration,
        cleaned_duration_string: cleanedDuration,
        value_passed_into_duration_parser: parserInput,
        parsed_output: parsed
    });

    if (!originalDuration || !parsed.start) {
        console.warn("[experience-parser] duration parsing failed", {
            company: cleanCompany(item.company),
            title: cleanText(item.title),
            raw_duration: originalDuration,
            reason: originalDuration
                ? "Start date could not be parsed from the captured duration text."
                : "No duration text was captured for this experience card."
        });
    }

    if (parsed.currently_working === true && parsed.end !== null) {
        console.warn("[experience-parser] current role had non-null end date", {
            company: cleanCompany(item.company),
            title: cleanText(item.title),
            raw_duration: originalDuration,
            parsed
        });
    }

    if (parsed.start && parsed.currently_working === false && parsed.end === null) {
        console.warn("[experience-parser] past role had missing end date", {
            company: cleanCompany(item.company),
            title: cleanText(item.title),
            raw_duration: originalDuration,
            parsed
        });
    }

    return parsed;
}

function dedupeExperience(items) {
    const seen = new Set();

    return items
        .map(item => ({
            company: cleanCompany(item.company),
            title: cleanText(item.title),
            duration: parseExperienceDuration(item)
        }))
        .filter(item => item.company && item.title)
        .filter(item => {
            const key = [
                normalizeExperienceKey(item.company),
                normalizeExperienceKey(item.title),
                JSON.stringify(item.duration)
            ].join("|");

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
}

function buildExperienceDetailUrl(value) {
    try {
        const url = new URL(value);
        const profileMatch = url.pathname.match(/^(\/in\/[^/]+)\/?/i);

        if (!profileMatch) {
            return "";
        }

        return `${url.origin}${profileMatch[1].replace(/\/$/, "")}/details/experience/`;
    } catch (err) {
        return "";
    }
}

async function waitForExperienceSectionReady(page) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForFunction(() => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const marker = document.querySelector("#experience");
        const hasHeading = [...document.querySelectorAll("main section")]
            .filter(section => !section.closest("aside"))
            .some(section => /^Experience$/i.test(clean(
                section.querySelector("h1, h2, h3, [role='heading'], [aria-level]")?.innerText ||
                section.querySelector("[aria-hidden='true']")?.innerText
            )));
        const detailHeading = /\/details\/experience\/?/i.test(location.pathname) &&
            [...document.querySelectorAll("main h1, main h2, main h3, main [role='heading'], main [aria-level]")]
                .some(heading => /^Experience$/i.test(clean(heading.innerText)));

        return !!marker || hasHeading || detailHeading;
    }, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const marker = document.querySelector("#experience");
        const section = marker?.closest("section") ||
            [...document.querySelectorAll("main section")]
                .filter(candidate => !candidate.closest("aside"))
                .find(candidate => /^Experience$/i.test(clean(
                    candidate.querySelector("h1, h2, h3, [role='heading'], [aria-level]")?.innerText ||
                    candidate.querySelector("[aria-hidden='true']")?.innerText
                )));

        section?.scrollIntoView({ block: "center", inline: "nearest" });
    }).catch(() => {});
    await page.waitForTimeout(700 + Math.floor(Math.random() * 500)).catch(() => {});
}

async function extractExperienceRowsFromCurrentPage(page) {
    try {
        await waitForExperienceSectionReady(page);

        return await page.evaluate(() => {
            const clean = value => (value || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const splitLines = value => (value || "")
                .split(/\n+/)
                .map(clean)
                .filter(Boolean);
            const uniqueLines = lines => {
                const result = [];

                for (const line of lines) {
                    if (result[result.length - 1] !== line) {
                        result.push(line);
                    }
                }

                return result;
            };
            const separatorPattern = /\s+[\u00b7\u2022]\s+/;
            const dateSeparator = "(?:-|\\u2013|\\u2014|\\bto\\b)";
            const month = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
            const monthYear = `(?:${month}\\s+)?\\d{4}`;
            const current = "(?:present|current(?:\\s+position)?|now|today)";
            const dateRangePattern = new RegExp(
                `\\b${monthYear}\\b\\s*${dateSeparator}\\s*(?:${current}|${monthYear})`,
                "i"
            );
            const yearOnlyRangePattern = new RegExp(
                `\\b\\d{4}\\b\\s*${dateSeparator}\\s*(?:${current}|\\d{4})`,
                "i"
            );
            const dateLinePattern = value =>
                dateRangePattern.test(value) ||
                yearOnlyRangePattern.test(value);
            const totalDurationPattern = /^\d+\s+(?:yr|yrs|year|years|mo|mos|month|months)\b/i;
            const employmentTypePattern = /^(?:full-time|part-time|self-employed|contract|freelance|internship|temporary|apprenticeship)$/i;
            const workplacePattern = /^(?:remote|on-site|hybrid)$/i;
            const sectionHeadingPattern = /^(?:experience|show all|show less)$/i;
            const isLocation = value =>
                workplacePattern.test(value) ||
                /\b(?:remote|on-site|hybrid)\b/i.test(value) ||
                /,\s*.+/.test(value) &&
                    /\b(?:india|united states|usa|united kingdom|canada|germany|sweden|australia|singapore|france|netherlands|ireland|area)\b/i.test(value);
            const isNoise = value =>
                !value ||
                sectionHeadingPattern.test(value) ||
                /^company name$/i.test(value) ||
                /^title$/i.test(value) ||
                /^employment type$/i.test(value) ||
                /^dates employed$/i.test(value) ||
                /^location$/i.test(value) ||
                /^logo$/i.test(value) ||
                /^.+\s+logo$/i.test(value) ||
                /^see more$/i.test(value) ||
                /^show all \d+/i.test(value) ||
                /\band\s+\+\d+\s+skills?\b/i.test(value) ||
                /^top skills$/i.test(value);
            const looksLikeCompanyMeta = value => {
                const parts = clean(value).split(separatorPattern).map(clean).filter(Boolean);

                return parts.length > 1 && parts.slice(1).some(part =>
                    employmentTypePattern.test(part) ||
                    totalDurationPattern.test(part)
                );
            };
            const cleanCompanyText = value => clean(value)
                .split(separatorPattern)[0]
                .replace(/\s+(?:full-time|part-time|contract|freelance|internship|temporary|apprenticeship|self-employed)$/i, "");
            const cleanCompanyHint = value => clean(value)
                .replace(/\s+logo$/i, "")
                .split(/\n+/)[0]
                .trim();
            const companyHintFrom = (element, root) => {
                const linesFromElement = candidate =>
                    splitLines(candidate?.innerText || candidate?.textContent)
                        .map(cleanCompanyHint)
                        .filter(Boolean);
                const companyFromLines = lines => {
                    const first = lines[0] || "";
                    const second = lines[1] || "";

                    if (looksLikeCompanyMeta(first)) {
                        return cleanCompanyText(first);
                    }

                    if (
                        first &&
                        !dateLinePattern(first) &&
                        !employmentTypePattern.test(first) &&
                        !workplacePattern.test(first) &&
                        !totalDurationPattern.test(first) &&
                        !isNoise(first) &&
                        (
                            looksLikeCompanyMeta(second) ||
                            totalDurationPattern.test(second) ||
                            employmentTypePattern.test(second) ||
                            workplacePattern.test(second) ||
                            isLocation(second)
                        )
                    ) {
                        return first;
                    }

                    return "";
                };
                const companyFromCompanyLinks = container => {
                    const links = [];

                    if (container?.matches?.("a[href*='/company/'], a[data-field='experience_company_logo']")) {
                        links.push(container);
                    }

                    links.push(
                        ...container.querySelectorAll("a[href*='/company/'], a[data-field='experience_company_logo']")
                    );

                    for (const link of links) {
                        const lines = linesFromElement(link);

                        // LinkedIn also wraps role rows in /company/ links.
                        // If the link itself contains a date range, it is a role,
                        // not the company summary for the group.
                        if (lines.some(dateLinePattern)) {
                            continue;
                        }

                        const company = companyFromLines(lines);

                        if (company) {
                            return company;
                        }
                    }

                    return "";
                };
                const companyFromContainer = container =>
                    companyFromCompanyLinks(container) ||
                    companyFromLines(linesFromElement(container));
                const companyFromPreviousSiblings = container => {
                    let sibling = container?.previousElementSibling;

                    while (sibling) {
                        const company = companyFromContainer(sibling);

                        if (company) {
                            return company;
                        }

                        sibling = sibling.previousElementSibling;
                    }

                    return "";
                };

                let current = element;

                while (current && current !== document.body && current !== root) {
                    const localCompany = companyFromCompanyLinks(current);

                    if (localCompany) {
                        return localCompany;
                    }

                    const parentCompany = companyFromContainer(current);

                    if (parentCompany && !dateLinePattern(linesFromElement(current)[1] || "")) {
                        return parentCompany;
                    }

                    const previousCompany = companyFromPreviousSiblings(current);

                    if (previousCompany) {
                        return previousCompany;
                    }

                    current = current.parentElement;
                }

                return "";
            };
            const companySummaryFromElement = element => {
                const companySelector = "a[href*='/company/'], a[data-field='experience_company_logo']";
                const linesFromElement = candidate =>
                    splitLines(candidate?.innerText || candidate?.textContent)
                        .map(cleanCompanyHint)
                        .filter(Boolean);
                const companyFromLines = lines => {
                    const first = lines[0] || "";
                    const second = lines[1] || "";

                    if (!first || lines.some(dateLinePattern)) {
                        return "";
                    }

                    if (looksLikeCompanyMeta(first)) {
                        return cleanCompanyText(first);
                    }

                    if (
                        !employmentTypePattern.test(first) &&
                        !workplacePattern.test(first) &&
                        !totalDurationPattern.test(first) &&
                        !isNoise(first) &&
                        (
                            looksLikeCompanyMeta(second) ||
                            totalDurationPattern.test(second) ||
                            employmentTypePattern.test(second) ||
                            workplacePattern.test(second) ||
                            isLocation(second)
                        )
                    ) {
                        return first;
                    }

                    return "";
                };
                const linkedElements = [];

                if (element?.matches?.(companySelector)) {
                    linkedElements.push(element);
                }

                linkedElements.push(...element.querySelectorAll(companySelector));

                for (const link of linkedElements) {
                    const company = companyFromLines(linesFromElement(link));

                    if (company) {
                        return company;
                    }
                }

                return companyFromLines(linesFromElement(element));
            };
            const isPossibleTitle = value =>
                value &&
                !isNoise(value) &&
                !dateLinePattern(value) &&
                !totalDurationPattern.test(value) &&
                !isLocation(value) &&
                !employmentTypePattern.test(value) &&
                !workplacePattern.test(value);
            const isPossibleCompany = value =>
                value &&
                !isNoise(value) &&
                !dateLinePattern(value) &&
                !isLocation(value) &&
                !workplacePattern.test(value) &&
                !employmentTypePattern.test(value) &&
                !totalDurationPattern.test(value);
            const getHeadingText = section => clean(
                section.querySelector("h1, h2, h3, [role='heading'], [aria-level]")?.innerText ||
                section.querySelector("[aria-hidden='true']")?.innerText
            );
            const marker = document.querySelector("#experience");
            const markerSection =
                marker?.closest("section") ||
                marker?.parentElement?.querySelector("section") ||
                marker?.nextElementSibling;
            const isExperienceDetailPage = /\/details\/experience\/?/i.test(location.pathname);
            const section = [...document.querySelectorAll("main section")]
                .filter(candidate => !candidate.closest("aside"))
                .find(candidate => /^Experience$/i.test(getHeadingText(candidate))) ||
                (markerSection?.matches?.("section") && !markerSection.closest("aside") ? markerSection : null) ||
                (isExperienceDetailPage ? document.querySelector("main") : null);

            if (!section) {
                return [];
            }

            const linesFrom = element => uniqueLines(splitLines(element?.innerText)
                .filter(line => !isNoise(line)));
            const parseLines = (rawLines, companyHint = "") => {
                const lines = uniqueLines(rawLines.filter(line => !isNoise(line)));
                const dateIndexes = lines
                    .map((line, index) => dateLinePattern(line) ? index : -1)
                    .filter(index => index >= 0);
                const roles = [];

                for (const dateIndex of dateIndexes) {
                    const previous = lines[dateIndex - 1] || "";
                    const beforePrevious = lines[dateIndex - 2] || "";
                    const earlier = lines[dateIndex - 3] || "";
                    let company = "";
                    let title = "";

                    if (employmentTypePattern.test(previous)) {
                        title = [beforePrevious, earlier].find(isPossibleTitle) || "";
                        company = companyHint ||
                            [...lines.slice(0, dateIndex)]
                                .reverse()
                                .find(line => isPossibleCompany(line) && line !== title) ||
                            "";
                    } else if (looksLikeCompanyMeta(previous) || separatorPattern.test(previous)) {
                        company = cleanCompanyText(previous);
                        title = [beforePrevious, earlier].find(isPossibleTitle) || "";
                    } else if (isPossibleTitle(beforePrevious)) {
                        company = cleanCompanyText(previous);
                        title = beforePrevious;
                    } else if (isPossibleTitle(previous)) {
                        title = previous;
                        company = companyHint || cleanCompanyText(earlier);
                    }

                    if (!company || employmentTypePattern.test(company)) {
                        company = companyHint || cleanCompanyText([...lines.slice(0, dateIndex)]
                            .reverse()
                            .find(line =>
                                line !== title &&
                                (
                                    looksLikeCompanyMeta(line) ||
                                    separatorPattern.test(line) ||
                                    isPossibleCompany(line)
                                )
                            ) || "");
                    }

                    if (
                        company &&
                        title &&
                        !employmentTypePattern.test(company) &&
                        cleanCompanyText(title).toLowerCase() !== company.toLowerCase()
                    ) {
                        roles.push({
                            company,
                            title: clean(title),
                            duration_text: lines[dateIndex]
                        });
                    }
                }

                return roles;
            };
            const candidates = [
                ...section.querySelectorAll("li, [role='listitem'], a[href*='/company/'], div[data-view-name], div.pvs-entity")
            ];
            const dateCandidates = candidates
                .map((element, index) => ({
                    element,
                    index
                }))
                .filter(item => dateLinePattern(clean(item.element.innerText)))
                .filter((item, index, all) =>
                    !all.some((other, otherIndex) =>
                        otherIndex !== index &&
                        other.element.contains(item.element) &&
                        clean(other.element.innerText) === clean(item.element.innerText)
                    )
                );
            const results = [];
            let currentCompanyHint = "";
            let dateCandidateIndex = 0;

            for (const candidate of candidates) {
                const summaryCompany = companySummaryFromElement(candidate);

                if (summaryCompany) {
                    currentCompanyHint = summaryCompany;
                }

                const nextDateCandidate = dateCandidates[dateCandidateIndex];

                if (!nextDateCandidate || nextDateCandidate.element !== candidate) {
                    continue;
                }

                dateCandidateIndex += 1;
                results.push(...parseLines(
                    linesFrom(candidate),
                    currentCompanyHint || companyHintFrom(candidate, section)
                ));
            }

            if (!results.length) {
                results.push(...parseLines(linesFrom(section)));
            }

            return results;
        });
    } catch (err) {
        console.warn("[experience-parser] experience extraction failed", {
            reason: err?.message || String(err)
        });
        return [];
    }
}

async function getExperienceDetailUrl(page) {
    try {
        const linkedUrl = await page.evaluate(() => {
            const clean = value => (value || "").replace(/\s+/g, " ").trim();
            const getHeadingText = section => clean(
                section.querySelector("h2, h3, [role='heading'], [aria-level]")?.innerText ||
                section.querySelector("[aria-hidden='true']")?.innerText
            );
            const marker = document.querySelector("#experience");
            const markerSection =
                marker?.closest("section") ||
                marker?.parentElement?.querySelector("section") ||
                marker?.nextElementSibling;
            const section = [...document.querySelectorAll("main section")]
                .filter(candidate => !candidate.closest("aside"))
                .find(candidate => /^Experience$/i.test(getHeadingText(candidate))) ||
                (markerSection?.matches?.("section") && !markerSection.closest("aside") ? markerSection : null);
            const root = section || document.querySelector("main") || document.body;
            const links = [...root.querySelectorAll("a[href]")];
            const detailLink = links.find(link =>
                /\/details\/experience\/?/i.test(link.href) ||
                /^show all .*experience/i.test(clean(link.innerText || link.getAttribute("aria-label")))
            );

            return detailLink?.href || "";
        });

        return linkedUrl || buildExperienceDetailUrl(page.url());
    } catch (err) {
        return buildExperienceDetailUrl(page.url());
    }
}

async function waitForExperienceDetailPage(page) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForFunction(() => {
        const clean = value => (value || "").replace(/\s+/g, " ").trim();
        const main = document.querySelector("main");
        const hasExperienceHeading = [...document.querySelectorAll(`
            main h1,
            main h2,
            main h3,
            main [role="heading"],
            main [aria-level]
        `)].some(heading => /^Experience$/i.test(clean(heading.innerText)));
        const hasDateRange = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b\s*(?:-|–|—|\bto\b)\s*(?:present|current|now|today|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\d{4})/i
            .test(clean(main?.innerText || ""));

        return hasExperienceHeading || hasDateRange;
    }, { timeout: 8000 }).catch(() => {});
}

async function settleExperienceDetailPage(page) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.85))).catch(() => {});
        await page.waitForTimeout(350 + Math.floor(Math.random() * 300)).catch(() => {});
    }

    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(250 + Math.floor(Math.random() * 250)).catch(() => {});
}

async function extractExperienceRowsFromDetailPage(page) {
    const currentUrl = page.url();
    const detailUrl = await getExperienceDetailUrl(page);

    if (!detailUrl || /\/details\/experience\/?/i.test(new URL(currentUrl).pathname)) {
        return [];
    }

    try {
        await page.goto(detailUrl, {
            waitUntil: "domcontentloaded",
            timeout: 15000
        });
        await waitForExperienceDetailPage(page);
        await settleExperienceDetailPage(page);

        return await extractExperienceRowsFromCurrentPage(page);
    } catch (err) {
        console.warn("[experience-parser] experience detail extraction failed", {
            detail_url: detailUrl,
            reason: err?.message || String(err)
        });
        return [];
    } finally {
        if (page.url() !== currentUrl) {
            await page.goto(currentUrl, {
                waitUntil: "domcontentloaded",
                timeout: 15000
            }).catch(() => {});
        }
    }
}

async function extractExperience(page, options = {}) {
    const initialExperience = Array.isArray(options.initialExperience)
        ? options.initialExperience
        : null;
    const mainExperience = initialExperience ||
        dedupeExperience(await extractExperienceRowsFromCurrentPage(page));

    if (!options.includeDetails) {
        return mainExperience;
    }

    const detailRows = await extractExperienceRowsFromDetailPage(page);

    if (!detailRows.length) {
        return mainExperience;
    }

    return dedupeExperience([
        ...detailRows,
        ...mainExperience
    ]);
}

async function hasExperienceSection(page) {
    try {
        return await page.evaluate(() => {
            const clean = value => (value || "").replace(/\s+/g, " ").trim();
            const marker = document.querySelector("#experience");

            return !!marker || [...document.querySelectorAll("main section")]
                .filter(section => !section.closest("aside"))
                .some(section => /^Experience$/i.test(clean(
                    section.querySelector("h2, h3, [role='heading'], [aria-level]")?.innerText ||
                    section.querySelector("[aria-hidden='true']")?.innerText
                )));
        });
    } catch (err) {
        return false;
    }
}

module.exports = {
    extractExperience,
    hasExperienceSection,
    buildExperienceDetailUrl
};
