const { cleanText, uniqueValues } = require("./dom-utils");

const BUSINESS_SKILLS = [
    "Revenue Operations",
    "Revenue Strategy",
    "Sales Automation",
    "Marketing Automation",
    "Strategic Partnerships",
    "Operations Management",
    "Business Development",
    "Data Analysis",
    "Automation",
    "Analytics",
    "Workflow Automation",
    "Process Optimization",
    "Process Automation",
    "Relationship Management",
    "Customer Success",
    "Sales Operations",
    "Marketing Operations",
    "Lead Generation",
    "Growth Strategy",
    "Go-to-Market Strategy",
    "Strategic Alliances",
    "Partnerships",
    "Operational Efficiency",
    "Data-Driven Strategy",
    "Business Analysis",
    "Management"
];

const BUSINESS_SKILL_RULES = [
    {
        skill: "Revenue Strategy",
        pattern: /\b(revenue strategy|revenue-generating|revenue generating)\b/i
    },
    {
        skill: "Sales Automation",
        pattern: /\b(sales automation|sales\b[\s\S]{0,100}\bautomation|automation workflows?\b[\s\S]{0,100}\bsales)\b/i
    },
    {
        skill: "Marketing Automation",
        pattern: /\b(marketing automation|marketing\b[\s\S]{0,100}\bautomation|automation workflows?\b[\s\S]{0,100}\bmarketing)\b/i
    },
    {
        skill: "Data Analysis",
        pattern: /\b(data analysis|advanced analytics|actionable insights|data-driven|data driven)\b/i
    },
    {
        skill: "Workflow Automation",
        pattern: /\b(workflow automation|automation workflows?)\b/i
    },
    {
        skill: "Relationship Management",
        pattern: /\b(relationship management|building relationships|cultivating relationships|nurturing strategic alliances)\b/i
    },
    {
        skill: "Business Development",
        pattern: /\b(business development|businessdevelopment|#businessdevelopment)\b/i
    }
];

function isIgnoredSkillText(value) {
    const text = cleanText(value);

    return !text ||
        /^skills(?:\s+\(\d+\))?$/i.test(text) ||
        /^endorse$/i.test(text) ||
        /^endorsements?$/i.test(text) ||
        /^\d+\s+endorsements?$/i.test(text) ||
        /^show all/i.test(text) ||
        /^show less$/i.test(text) ||
        /^see more$/i.test(text) ||
        /^add skill$/i.test(text) ||
        /^follow$/i.test(text) ||
        /^message$/i.test(text) ||
        /^connect$/i.test(text) ||
        /^logo$/i.test(text) ||
        /^.+\s+logo$/i.test(text) ||
        /^\d+$/.test(text) ||
        /\band\s+\+\d+\s+skills?\b/i.test(text) ||
        /\bat\s+/i.test(text) ||
        /\b(college|university|school|institute|academy)\b/i.test(text) ||
        /\bramaiah\b/i.test(text);
}

function filterSkillValues(values, limit = 25) {
    return uniqueValues(values)
        .filter(skill => !isIgnoredSkillText(skill))
        .slice(0, limit);
}

function normalizeSkillName(value) {
    const cleaned = cleanText(value)
        .replace(/\s*&\s*/g, " & ")
        .replace(/\s*\/\s*/g, " / ")
        .replace(/\s+/g, " ");
    const knownSkill = BUSINESS_SKILLS.find(skill =>
        skill.toLowerCase() === cleaned.toLowerCase()
    );

    return knownSkill || cleaned;
}

function skillPattern(skill) {
    const escaped = skill
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");

    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
}

function matchBusinessSkills(text) {
    const sourceText = cleanText(text);

    if (!sourceText) {
        return [];
    }

    return uniqueValues([
        ...BUSINESS_SKILLS.filter(skill => skillPattern(skill).test(sourceText)),
        ...BUSINESS_SKILL_RULES
            .filter(rule => rule.pattern.test(sourceText))
            .map(rule => rule.skill)
    ]);
}

async function extractSkills(page) {
    try {
        const skills = await page.evaluate(() => {
            const clean = value => (value || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const isIgnoredSkillText = value =>
                !value ||
                /^skills(?:\s+\(\d+\))?$/i.test(value) ||
                /^endorse$/i.test(value) ||
                /^endorsements?$/i.test(value) ||
                /^\d+\s+endorsements?$/i.test(value) ||
                /^show all/i.test(value) ||
                /^show less$/i.test(value) ||
                /^see more$/i.test(value) ||
                /^add skill$/i.test(value) ||
                /^follow$/i.test(value) ||
                /^message$/i.test(value) ||
                /^connect$/i.test(value) ||
                /^logo$/i.test(value) ||
                /^.+\s+logo$/i.test(value) ||
                /^\d+$/.test(value) ||
                /\band\s+\+\d+\s+skills?\b/i.test(value) ||
                /\bat\s+/i.test(value) ||
                /\b(college|university|school|institute|academy)\b/i.test(value) ||
                /\bramaiah\b/i.test(value);
            const getHeadingText = section => clean(
                section.querySelector("h2, h3, [role='heading'], [aria-level]")?.innerText ||
                section.querySelector("[aria-hidden='true']")?.innerText
            );
            const marker = document.querySelector("#skills");
            const markerSection =
                marker?.closest("section") ||
                marker?.parentElement?.querySelector("section") ||
                marker?.nextElementSibling;
            const section = [...document.querySelectorAll("main section")]
                .filter(candidate => !candidate.closest("aside"))
                .find(candidate => /^Skills(?:\s+\(\d+\))?$/i.test(getHeadingText(candidate))) ||
                (markerSection?.matches?.("section") && !markerSection.closest("aside") ? markerSection : null);

            if (!section) {
                return [];
            }

            const firstMeaningfulLine = item => (item.innerText || "")
                .split(/\n+/)
                .map(clean)
                .find(line => !isIgnoredSkillText(line)) || "";
            const listItems = [...section.querySelectorAll("li, [role='listitem'], a[href*='/skills/']")]
                .map(firstMeaningfulLine)
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

        return filterSkillValues(skills);
    } catch (err) {
        return [];
    }
}

module.exports = {
    extractSkills,
    matchBusinessSkills,
    normalizeSkillName,
    filterSkillValues,
    isIgnoredSkillText
};
