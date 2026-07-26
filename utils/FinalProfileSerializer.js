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
    "company",
    "current_company",
    "position",
    "followers",
    "connections",
    "experience",
    "education",
    "skills",
    "technologies",
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
    "shared_skills",
    "shared_technologies",
    "experience_overlap",
    "education_overlap",
    "department_similarity",
    "years_at_company",
    "current_employee"
];
const RELATIONSHIP_BOOLEAN_FIELDS = [
    "same_company", "same_location", "same_school", "same_department", "current_employee"
];
const RELATIONSHIP_NUMBER_FIELDS = ["department_similarity", "years_at_company"];

function hasOwn(source, field) {
    return Object.prototype.hasOwnProperty.call(source || {}, field);
}

function cleanText(value) {
    return String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toText(value) {
    return typeof value === "string"
        ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
        : "";
}

function parseScore(value) {
    if (value === null || value === undefined || value === "") return null;
    const score = Number(value);

    return Number.isFinite(score) ? Number(score.toFixed(2)) : null;
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

function serializeRelationshipEvidence(relationshipEvidence) {
    if (relationshipEvidence === null || relationshipEvidence === undefined) return null;
    return {
        same_company: relationshipEvidence.same_company === true,
        same_location: relationshipEvidence.same_location === true,
        same_school: relationshipEvidence.same_school === true,
        same_department: relationshipEvidence.same_department === true,
        shared_skills: serializeStringArray(relationshipEvidence.shared_skills),
        shared_technologies: serializeStringArray(relationshipEvidence.shared_technologies),
        experience_overlap: serializeJsonValue(relationshipEvidence.experience_overlap, []),
        education_overlap: serializeJsonValue(relationshipEvidence.education_overlap, []),
        department_similarity: parseScore(relationshipEvidence.department_similarity),
        years_at_company: parseScore(relationshipEvidence.years_at_company),
        current_employee: relationshipEvidence.current_employee === true
    };
}

function serializeJsonValue(value, missingValue = null, seen = new WeakSet()) {
    if (value === undefined) return missingValue;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("Relationship evidence contains a non-finite number.");
        return value;
    }
    if (typeof value !== "object") {
        throw new TypeError("Relationship evidence contains a non-JSON-compatible value.");
    }
    if (seen.has(value)) throw new TypeError("Relationship evidence contains a circular reference.");
    seen.add(value);
    const output = Array.isArray(value)
        ? value.map(item => serializeJsonValue(item, null, seen))
        : Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, serializeJsonValue(item, null, seen)]));
    seen.delete(value);
    return output;
}

function validateRelationshipEvidence(profiles) {
    profiles.forEach((profile, index) => {
        const candidateName = String(profile?.name || `index ${index}`);
        const evidence = profile?.relationship_evidence;
        const prefix = `Invalid relationship_evidence for candidate "${candidateName}":`;

        if (evidence === null) return;
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
            throw new TypeError(`${prefix} expected a non-null object`);
        }
        for (const field of RELATIONSHIP_EVIDENCE_FIELDS) {
            if (!hasOwn(evidence, field)) throw new TypeError(`${prefix} missing ${field}`);
        }
        for (const field of RELATIONSHIP_BOOLEAN_FIELDS) {
            if (typeof evidence[field] !== "boolean") {
                throw new TypeError(`${prefix} ${field} must be a boolean`);
            }
        }
        for (const field of RELATIONSHIP_NUMBER_FIELDS) {
            if (evidence[field] !== null &&
                (typeof evidence[field] !== "number" || !Number.isFinite(evidence[field]))) {
                throw new TypeError(`${prefix} ${field} must be a finite number or null`);
            }
        }
        for (const field of ["shared_skills", "shared_technologies"]) {
            if (!Array.isArray(evidence[field]) || evidence[field].some(value => typeof value !== "string")) {
                throw new TypeError(`${prefix} ${field} must be an array of strings`);
            }
        }
    });
}

function serializeExperience(experience) {
    if (!Array.isArray(experience)) return [];

    return experience
        .filter(item => item && typeof item === "object" && !Array.isArray(item))
        .map(item => {
            const duration = parseDurationRange(item.duration);

            return {
                company: toText(item.company),
                title: toText(item.title),
                duration: {
                    start: toText(duration.start),
                    end: duration.end === null ? null : toText(duration.end),
                    currently_working: duration.currently_working === true
                }
            };
        });
}

function serializeEducation(education) {
    if (!Array.isArray(education)) return [];

    return education
        .filter(item => item && typeof item === "object" && !Array.isArray(item))
        .map(item => ({
            school: toText(item.school),
            degree: toText(item.degree),
            field_of_study: toText(item.field_of_study),
            dates: toText(item.dates),
            activities: toText(item.activities),
            honors: toText(item.honors)
        }));
}

function serializeStringArray(values) {
    if (!Array.isArray(values)) return [];

    return [...new Set(values
        .filter(value => typeof value === "string")
        .map(toText)
        .filter(Boolean))];
}

function firstLocationPart(location) {
    return cleanText(location).split(",").map(cleanText).filter(Boolean)[0] || "";
}

function firstSchool(profile = {}, evidence = {}) {
    const school = cleanText(
        evidence.candidate_school ||
        (Array.isArray(profile.education) && profile.education[0]?.school)
    );

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

function serializeFinalProfile(profile = {}) {
    const relationshipEvidence = serializeRelationshipEvidence(
        profile.relationship_evidence
    );
    const role = serializeRole(profile);
    const relationshipSummary = buildRelationshipSummary(
        profile,
        relationshipEvidence || {},
        role
    );

    return {
        name: toText(profile.name),
        linkedin_url: toText(profile.linkedin_url),
        headline: toText(profile.headline),
        location: toText(profile.location),
        about: toText(profile.about),
        company: serializeJsonValue(profile.company, null),
        current_company: toText(profile.current_company),
        position: toText(profile.position),
        followers: normalizeNumericField(profile.followers),
        connections: normalizeNumericField(
            hasOwn(profile, "connections") ? profile.connections : profile.connection
        ),
        experience: serializeExperience(profile.experience),
        education: serializeEducation(profile.education),
        skills: serializeStringArray(profile.skills),
        technologies: serializeStringArray(profile.technologies),
        relationship_evidence: relationshipEvidence,
        relationship_summary: serializeStringArray(relationshipSummary),
        role: toText(role),
        seniority: toText(profile.seniority),
        decision_power: toText(profile.decision_power),
        hiring_influence: toText(profile.hiring_influence)
    };
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

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, requiredKeys, prefix) {
    const keys = Object.keys(value);
    if (keys.length !== requiredKeys.length || keys.some((key, index) => key !== requiredKeys[index])) {
        throw new TypeError(`${prefix} keys must be exactly: ${requiredKeys.join(", ")}`);
    }
}

function validateClassifiedCandidates(candidates) {
    if (!Array.isArray(candidates)) {
        throw new TypeError("Invalid classified candidate output: root must be an array");
    }

    candidates.forEach((candidate, index) => {
        const name = toText(candidate?.name) || `index ${index}`;
        const prefix = `Invalid classified candidate "${name}" at index ${index}:`;
        if (!isPlainObject(candidate)) throw new TypeError(`${prefix} candidate must be a plain object`);
        assertExactKeys(candidate, FINAL_PROFILE_FIELDS, prefix);

        for (const field of ["name", "linkedin_url", "headline", "location", "about", "current_company", "position", "role", "seniority", "decision_power", "hiring_influence"]) {
            if (typeof candidate[field] !== "string") throw new TypeError(`${prefix} ${field} must be a string`);
        }
        if (candidate.company !== null && typeof candidate.company !== "string" && !isPlainObject(candidate.company)) {
            throw new TypeError(`${prefix} company must be a string, plain object, or null`);
        }
        for (const field of ["followers", "connections"]) {
            if (!isNullableNumber(candidate[field])) throw new TypeError(`${prefix} ${field} must be a finite number or null`);
        }

        if (!Array.isArray(candidate.experience)) throw new TypeError(`${prefix} experience must be an array`);
        candidate.experience.forEach((entry, entryIndex) => {
            const entryPrefix = `${prefix} experience[${entryIndex}]`;
            if (!isPlainObject(entry)) throw new TypeError(`${entryPrefix} must be a plain object`);
            assertExactKeys(entry, ["company", "title", "duration"], entryPrefix);
            if (typeof entry.company !== "string" || typeof entry.title !== "string") throw new TypeError(`${entryPrefix} company and title must be strings`);
            if (!isPlainObject(entry.duration)) throw new TypeError(`${entryPrefix}.duration must be a plain object`);
            assertExactKeys(entry.duration, ["start", "end", "currently_working"], `${entryPrefix}.duration`);
            if (typeof entry.duration.start !== "string") throw new TypeError(`${entryPrefix}.duration.start must be a string`);
            if (entry.duration.end !== null && typeof entry.duration.end !== "string") throw new TypeError(`${entryPrefix}.duration.end must be a string or null`);
            if (typeof entry.duration.currently_working !== "boolean") throw new TypeError(`${entryPrefix}.duration.currently_working must be a boolean`);
        });

        if (!Array.isArray(candidate.education)) throw new TypeError(`${prefix} education must be an array`);
        candidate.education.forEach((entry, entryIndex) => {
            const entryPrefix = `${prefix} education[${entryIndex}]`;
            if (!isPlainObject(entry)) throw new TypeError(`${entryPrefix} must be a plain object`);
            assertExactKeys(entry, ["school", "degree", "field_of_study", "dates", "activities", "honors"], entryPrefix);
            for (const field of ["school", "degree", "field_of_study", "dates", "activities", "honors"]) {
                if (typeof entry[field] !== "string") throw new TypeError(`${entryPrefix}.${field} must be a string`);
            }
        });

        for (const field of ["skills", "technologies", "relationship_summary"]) {
            if (!Array.isArray(candidate[field]) || candidate[field].some(value => typeof value !== "string")) {
                throw new TypeError(`${prefix} ${field} must be an array of strings`);
            }
        }
        if (candidate.relationship_evidence !== null) {
            if (!isPlainObject(candidate.relationship_evidence)) throw new TypeError(`${prefix} relationship_evidence must be a plain object or null`);
            assertExactKeys(candidate.relationship_evidence, RELATIONSHIP_EVIDENCE_FIELDS, `${prefix} relationship_evidence`);
        }
        validateRelationshipEvidence([candidate]);
    });

    return true;
}

module.exports = {
    FINAL_PROFILE_FIELDS,
    RELATIONSHIP_EVIDENCE_FIELDS,
    serializeRelationshipEvidence,
    serializeExperience,
    serializeEducation,
    serializeStringArray,
    serializeFinalProfile,
    serializeFinalProfiles,
    validateRelationshipEvidence,
    validateClassifiedCandidates
};
