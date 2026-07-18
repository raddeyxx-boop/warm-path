const { parseDurationRange } = require("./DurationParser");
const {
    isNullableNumber,
    normalizeNumericField
} = require("./NumericNormalizer");

const FINAL_PROFILE_FIELDS = [
    "name",
    "linkedin_url",
    "headline",
    "location",
    "about",
    "current_company",
    "position",
    "followers",
    "connections",
    "experience",
    "education",
    "skills",
    "relationship_evidence",
    "relationship_summary",
    "role",
    "seniority",
    "decision_power",
    "hiring_influence"
];

const RELATIONSHIP_EVIDENCE_FIELDS = [
    "same_company",
    "same_location",
    "same_school",
    "same_department",
    "department_similarity",
    "years_at_company"
];

function hasOwn(source, field) {
    return Object.prototype.hasOwnProperty.call(source || {}, field);
}

function cleanText(value) {
    return String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseScore(value) {
    const score = Number(value);

    return Number.isFinite(score) ? Number(score.toFixed(2)) : 0;
}

function isBusinessDevelopment(profile = {}) {
    const text = [
        profile.position,
        profile.headline,
        ...(Array.isArray(profile.experience)
            ? profile.experience.map(item => item && item.title)
            : [])
    ]
        .map(cleanText)
        .join(" ")
        .toLowerCase();

    return /\bbusiness\s+develop(?:er|ment)\b|\bbde\b|\bbdm\b/.test(text);
}

function roleFromTitle(profile = {}) {
    const text = [
        profile.position,
        profile.headline,
        ...(Array.isArray(profile.experience)
            ? profile.experience.map(item => item && item.title)
            : [])
    ]
        .map(cleanText)
        .join(" ")
        .toLowerCase();

    if (/\b(hr|human resources|talent acquisition|recruiter|people operations|hr executive|hr manager)\b/.test(text)) {
        return "HR";
    }

    if (/\b(supply chain|logistics|warehouse|inventory)\b/.test(text)) {
        return "Supply Chain";
    }

    return "";
}

function serializeRole(profile = {}) {
    const titleRole = roleFromTitle(profile);

    if (titleRole) {
        return titleRole;
    }

    if (isBusinessDevelopment(profile)) {
        return "Business Development";
    }

    return cleanText(profile.role);
}

function serializeRelationshipEvidence(relationshipEvidence = {}) {
    const sameDepartment = Boolean(relationshipEvidence.same_department);

    return {
        same_company: Boolean(relationshipEvidence.same_company),
        same_location: Boolean(relationshipEvidence.same_location),
        same_school: Boolean(relationshipEvidence.same_school),
        same_department: sameDepartment,
        department_similarity: parseScore(
            relationshipEvidence.department_similarity ?? (sameDepartment ? 1 : 0)
        ),
        years_at_company: parseScore(relationshipEvidence.years_at_company)
    };
}

function serializeExperience(experience) {
    return Array.isArray(experience)
        ? experience.map(item => {
            const record = { ...(item || {}) };

            if (hasOwn(record, "duration")) {
                record.duration = parseDurationRange(record.duration);
            }

            return record;
        })
        : [];
}

function firstLocationPart(location) {
    return cleanText(location).split(",").map(cleanText).filter(Boolean)[0] || "";
}

function firstSchool(profile = {}, evidence = {}) {
    const school = cleanText(
        evidence.candidate_school ||
        (Array.isArray(profile.education) && profile.education[0]?.school)
    );

    if (/ramaiah/i.test(school)) {
        return "Ramaiah College";
    }

    return school;
}

function uniqueValues(values) {
    return [...new Set(values.map(cleanText).filter(Boolean))];
}

function appendSummary(summary, value) {
    const cleaned = cleanText(value);

    if (cleaned && !summary.includes(cleaned)) {
        summary.push(cleaned);
    }
}

function buildRelationshipSummary(profile = {}, relationshipEvidence = {}, role = "") {
    const summary = uniqueValues(
        Array.isArray(profile.relationship_summary)
            ? profile.relationship_summary
            : []
    );
    const hasSourceSummary = summary.length > 0;
    const sourceEvidence = profile.relationship_evidence || {};

    if (!hasSourceSummary && relationshipEvidence.same_company) {
        const company = cleanText(
            profile.current_company ||
            sourceEvidence.company_name
        );

        if (company) {
            appendSummary(summary, `Works at ${company}`);
        }
    }

    if (!hasSourceSummary && relationshipEvidence.same_location) {
        const location = firstLocationPart(
            sourceEvidence.candidate_location ||
            profile.location
        );

        if (location) {
            appendSummary(summary, `Based in ${location}`);
        }
    }

    if (!hasSourceSummary && relationshipEvidence.same_school) {
        const school = firstSchool(profile, sourceEvidence);

        if (school) {
            appendSummary(summary, `Studied at ${school}`);
        }
    }

    if (role) {
        appendSummary(summary, `${role} role`);
    }

    return summary.slice(0, 8);
}

function copyOptionalFields(profile, serialized) {
    for (const field of [
        "name",
        "linkedin_url",
        "headline",
        "location",
        "about",
        "current_company",
        "position",
        "education",
        "skills",
        "seniority",
        "decision_power",
        "hiring_influence"
    ]) {
        if (hasOwn(profile, field)) {
            serialized[field] = profile[field];
        }
    }
}

function serializeFinalProfile(profile = {}) {
    const serialized = {};

    copyOptionalFields(profile, serialized);

    serialized.followers = normalizeNumericField(profile.followers);

    if (hasOwn(profile, "connections") || hasOwn(profile, "connection")) {
        serialized.connections = normalizeNumericField(
            hasOwn(profile, "connections") ? profile.connections : profile.connection
        );
    }

    serialized.experience = serializeExperience(profile.experience);
    serialized.relationship_evidence = serializeRelationshipEvidence(
        profile.relationship_evidence
    );

    const role = serializeRole(profile);

    if (role) {
        serialized.role = role;
    }

    serialized.relationship_summary = buildRelationshipSummary(
        profile,
        serialized.relationship_evidence,
        role
    );

    const ordered = {};

    for (const field of FINAL_PROFILE_FIELDS) {
        if (hasOwn(serialized, field)) {
            ordered[field] = serialized[field];
        }
    }

    validateNumericOutput(ordered, "followers");
    validateNumericOutput(ordered, "connections");

    return ordered;
}

function validateNumericOutput(profile, field) {
    if (hasOwn(profile, field) && !isNullableNumber(profile[field])) {
        throw new TypeError(`${field} must be a number or null before writing JSON.`);
    }
}

function serializeFinalProfiles(profiles) {
    return Array.isArray(profiles)
        ? profiles.map(serializeFinalProfile)
        : [];
}

module.exports = {
    FINAL_PROFILE_FIELDS,
    RELATIONSHIP_EVIDENCE_FIELDS,
    serializeFinalProfile,
    serializeFinalProfiles
};
