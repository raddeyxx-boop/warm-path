const {
    normalizeCompany
} = require("../utils/CompanyNormalizer");

const {
    normalizeDepartment: importedNormalizeDepartment
} = require("../utils/DepartmentNormalizer");

const {
    compareLocations
} = require("../utils/LocationNormalizer");

const {
    parseDurationRange,
    yearsFromDuration
} = require("../utils/DurationParser");

const {
    matchTechnologies
} = require("../utils/TechnologyDictionary");

const {
    debugLog
} = require("../utils/DebugLogger");
const {
    normalizeNumericField
} = require("../utils/NumericNormalizer");

function cleanText(value) {
    return (value || "").toString().trim();
}

function normalizeDepartmentFallback(value) {
    if (!value) {
        return "";
    }

    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ");

    if (
        normalized.includes("hr") ||
        normalized.includes("human resources") ||
        normalized.includes("recruit")
    ) {
        return "hr";
    }

    if (
        normalized.includes("finance") ||
        normalized.includes("account") ||
        normalized.includes("accountant") ||
        normalized.includes("tax")
    ) {
        return "finance";
    }

    if (
        normalized.includes("sales") ||
        normalized.includes("business development") ||
        normalized.includes("business developer")
    ) {
        return "business development";
    }

    if (
        normalized.includes("engineer") ||
        normalized.includes("developer") ||
        normalized.includes("software") ||
        normalized.includes("frontend") ||
        normalized.includes("backend") ||
        normalized.includes("full stack") ||
        normalized.includes("fullstack") ||
        normalized.includes("devops") ||
        normalized.includes("qa") ||
        normalized.includes("test")
    ) {
        return "engineering";
    }

    if (
        normalized.includes("marketing") ||
        normalized.includes("seo") ||
        normalized.includes("content")
    ) {
        return "marketing";
    }

    if (normalized.includes("product")) {
        return "product";
    }

    if (
        normalized.includes("design") ||
        normalized.includes("ux") ||
        normalized.includes("ui")
    ) {
        return "design";
    }

    return normalized.replace(/\s+/g, " ").trim();
}

function normalizeDepartmentValue(value) {
    if (typeof importedNormalizeDepartment === "function") {
        return importedNormalizeDepartment(value);
    }

    return normalizeDepartmentFallback(value);
}

function getDepartments(entity) {
    return [
        entity.role,
        entity.position,
        entity.headline
    ]
        .map(normalizeDepartmentValue)
        .filter(Boolean);
}

function calculateDepartmentSimilarity(candidateDepartments, targetDepartments) {
    if (!candidateDepartments.length || !targetDepartments.length) {
        return 0;
    }

    if (candidateDepartments.some(department => targetDepartments.includes(department))) {
        return 1;
    }

    const relatedDepartmentGroups = [
        ["business development", "sales", "revenue", "partnerships"],
        ["software", "engineering", "backend", "frontend", "infrastructure", "qa"],
        ["hr", "people", "talent acquisition"],
        ["marketing", "growth", "content"],
        ["data", "analytics", "business intelligence"]
    ];

    for (const group of relatedDepartmentGroups) {
        const candidateRelated = candidateDepartments.some(department => group.includes(department));
        const targetRelated = targetDepartments.some(department => group.includes(department));

        if (candidateRelated && targetRelated) {
            return 0.8;
        }
    }

    return 0;
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
}

function firstNonEmpty(values) {
    return values.find(value => cleanText(value)) || "";
}

function getPrimaryCompany(entity) {
    return firstNonEmpty([
        entity.current_company,
        entity.company
    ]);
}

function getCompanyEntries(entity) {
    const entries = [];

    for (const source of ["current_company", "company"]) {
        const raw = cleanText(entity[source]);
        const normalized = normalizeCompany(raw);

        if (normalized) {
            entries.push({ raw, normalized, source });
        }
    }

    for (const exp of entity.experience || []) {
        const raw = cleanText(exp.company);
        const normalized = normalizeCompany(raw);

        if (normalized) {
            entries.push({
                raw,
                normalized,
                source: "experience",
                current: getDuration(exp?.duration).currently_working === true,
                experience: exp
            });
        }
    }

    return entries;
}

function getNormalizedCompanies(entity) {
    return uniqueValues(
        getCompanyEntries(entity).map(entry => entry.normalized)
    );
}

function debugRelationshipComparison(message, details) {
    if (process.env.RELATIONSHIP_DEBUG === "1") {
        console.log("[relationship-debug]", message, details);
    }

    debugLog("relationship", message, details);
}

function calculateYearsAtCompany(experience) {
    return yearsFromDuration(experience?.duration);
}

function getDuration(duration) {
    return parseDurationRange(duration || {});
}

function normalizeList(values) {
    return uniqueValues(
        (values || [])
            .map(value => typeof value === "string" ? cleanText(value) : cleanText(value?.name || value?.title || value?.text))
            .filter(Boolean)
    );
}

function normalizeComparableText(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getSharedList(candidateValues, targetValues) {
    const targetMap = new Map();

    for (const value of normalizeList(targetValues)) {
        targetMap.set(normalizeComparableText(value), value);
    }

    if (targetMap.size === 0) {
        return [];
    }

    return normalizeList(candidateValues)
        .filter(value => targetMap.has(normalizeComparableText(value)));
}

function getSharedSkills(candidateValues, targetValues) {
    const targets = normalizeList(targetValues)
        .map(value => ({
            raw: value,
            normalized: normalizeComparableText(value)
        }))
        .filter(item => item.normalized);

    if (!targets.length) {
        return [];
    }

    return uniqueValues(
        normalizeList(candidateValues)
            .filter(candidate => {
                const normalizedCandidate = normalizeComparableText(candidate);

                return targets.some(target =>
                    normalizedCandidate === target.normalized ||
                    (
                        normalizedCandidate.length > 4 &&
                        target.normalized.length > 4 &&
                        (
                            normalizedCandidate.includes(target.normalized) ||
                            target.normalized.includes(normalizedCandidate)
                        )
                    )
                );
            })
    );
}

function addExplanation(relationshipEvidence, explanation) {
    const cleaned = cleanText(explanation);

    if (cleaned && !relationshipEvidence.explanations.includes(cleaned)) {
        relationshipEvidence.explanations.push(cleaned);
    }
}

function titleCase(value) {
    return cleanText(value)
        .split(" ")
        .filter(Boolean)
        .map(word => {
            const upper = word.toUpperCase();

            if (["AI", "HR", "ML", "QA", "UI", "UX"].includes(upper)) {
                return upper;
            }

            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(" ");
}

function addSummary(summary, value) {
    const cleaned = cleanText(value);

    if (cleaned && !summary.includes(cleaned)) {
        summary.push(cleaned);
    }
}

function formatList(values, limit = 3) {
    const selected = uniqueValues(values.map(cleanText)).slice(0, limit);

    return selected.join(", ");
}

function firstLocationPart(location) {
    return cleanText(location)
        .split(",")
        .map(cleanText)
        .filter(Boolean)[0] || "";
}

function displaySchoolName(value) {
    const school = cleanText(value);

    if (/ramaiah/i.test(school)) {
        return "Ramaiah College";
    }

    return school;
}

function buildRelationshipSummary(profile, relationshipEvidence) {
    const summary = [];
    const company = cleanText(
        relationshipEvidence.company_name ||
        profile.current_company ||
        profile.company
    );
    const department = titleCase(
        relationshipEvidence.candidate_department ||
        relationshipEvidence.target_department
    );
    const location = firstLocationPart(
        relationshipEvidence.candidate_location ||
        profile.location
    );
    const school = displaySchoolName(
        relationshipEvidence.candidate_school ||
        profile.education?.[0]?.school
    );
    const sharedTechnologies = formatList(relationshipEvidence.shared_technologies);
    const sharedSkills = formatList(relationshipEvidence.shared_skills);
    const normalizedCurrentCompany = normalizeCompany(company);
    const overlappingPreviousEmployers = relationshipEvidence.experience_overlap
        .filter(value =>
            !relationshipEvidence.same_company ||
            normalizeCompany(value) !== normalizedCurrentCompany
        );
    const sharedEmployers = formatList(
        overlappingPreviousEmployers.map(titleCase),
        2
    );
    const educationOverlap = formatList(
        relationshipEvidence.education_overlap.map(titleCase),
        2
    );

    if (relationshipEvidence.same_company && company) {
        addSummary(summary, `Works at ${company}`);
    }

    if (relationshipEvidence.same_department && department) {
        addSummary(summary, `Same ${department} department`);
    } else if (relationshipEvidence.department_similarity >= 0.8 && department) {
        addSummary(summary, `Similar ${department} department`);
    }

    if (relationshipEvidence.same_location && location) {
        addSummary(summary, `Based in ${location}`);
    }

    if (relationshipEvidence.same_school && school) {
        addSummary(summary, `Studied at ${school}`);
    }

    if (sharedEmployers) {
        addSummary(summary, `Shared employer: ${sharedEmployers}`);
    }

    if (educationOverlap) {
        addSummary(summary, `Shared education: ${educationOverlap}`);
    }

    if (sharedTechnologies) {
        addSummary(summary, `Shared technologies: ${sharedTechnologies}`);
    }

    if (sharedSkills) {
        addSummary(summary, `Shared skills: ${sharedSkills}`);
    }

    if (relationshipEvidence.network_strength >= 70) {
        addSummary(summary, "Strong LinkedIn network");
    }

    return summary.slice(0, 8);
}

function buildRelationshipEvidence(profile, target) {
    profile = profile || {};
    target = target || {};

    const relationshipEvidence = {

        same_company: false,

        company_name: "",

        same_location: false,

        same_city: false,

        same_state: false,

        same_country: false,

        candidate_location: "",

        target_location: "",

        same_school: false,

        candidate_school: "",

        target_school: "",

        same_department: false,

        department_similarity: 0,

        candidate_department: "",

        target_department: "",

        years_at_company: 0,

        current_employee: false,

        shared_skills: [],

        shared_technologies: [],

        experience_overlap: [],

        education_overlap: [],

        explanations: [],

        network_strength: 0,

        relationship_strength: 0

    };

    const candidateCompanyRaw = getPrimaryCompany(profile);
    const targetCompanyRaw = getPrimaryCompany(target);
    const candidateCompany = normalizeCompany(candidateCompanyRaw);
    const targetCompany = normalizeCompany(targetCompanyRaw);

    const candidateCompanyEntries = getCompanyEntries(profile);
    const targetCompanyEntries = getCompanyEntries(target);
    const candidateCompanies = getNormalizedCompanies(profile);
    const targetCompanies = getNormalizedCompanies(target);

    debugRelationshipComparison("company comparison", {
        candidate_company: candidateCompanyRaw,
        normalized_candidate_company: candidateCompany,
        target_company: targetCompanyRaw,
        normalized_target_company: targetCompany,
        candidate_companies: candidateCompanyEntries,
        target_companies: targetCompanyEntries
    });

    if (candidateCompany && targetCompany && candidateCompany === targetCompany) {
        relationshipEvidence.same_company = true;
        relationshipEvidence.company_name = candidateCompanyRaw || targetCompanyRaw;
        relationshipEvidence.current_employee = true;
        addExplanation(
            relationshipEvidence,
            `Worked together at ${relationshipEvidence.company_name}`
        );
    }

    const currentExperience = (profile.experience || []).find(exp => {
        const expCompany = normalizeCompany(exp.company || "");
        const duration = getDuration(exp?.duration);

        return duration.currently_working === true &&
            (
                (targetCompany && expCompany === targetCompany) ||
                (candidateCompany && expCompany === candidateCompany) ||
                targetCompanies.includes(expCompany)
            );
    });

    if (currentExperience) {
        relationshipEvidence.current_employee = true;
        relationshipEvidence.years_at_company = calculateYearsAtCompany(currentExperience);

        if (!relationshipEvidence.company_name) {
            relationshipEvidence.company_name =
                currentExperience.company || candidateCompanyRaw || targetCompanyRaw;
        }
    }

    if (!relationshipEvidence.same_company) {
        const matchingCurrentCompany = candidateCompanyEntries.find(entry =>
            (entry.source === "current_company" || entry.current === true) &&
            targetCompanies.includes(entry.normalized)
        );

        if (matchingCurrentCompany) {
            relationshipEvidence.same_company = true;
            relationshipEvidence.current_employee = true;
            relationshipEvidence.company_name = matchingCurrentCompany.raw;
            addExplanation(
                relationshipEvidence,
                `Worked together at ${relationshipEvidence.company_name}`
            );
        } else {
            debugRelationshipComparison("same_company failed", {
                reason: "No candidate current company matched target company signals after normalization.",
                candidateCompanies,
                targetCompanies
            });
        }
    }

    const candidateDepartments = uniqueValues(getDepartments(profile));
    const targetDepartments = uniqueValues(getDepartments(target));

    relationshipEvidence.candidate_department = candidateDepartments[0] || "";
    relationshipEvidence.target_department = targetDepartments[0] || "";

    const matchingDepartment = candidateDepartments.find(department =>
        targetDepartments.includes(department)
    );

    relationshipEvidence.department_similarity = calculateDepartmentSimilarity(
        candidateDepartments,
        targetDepartments
    );

    if (matchingDepartment) {
        relationshipEvidence.same_department = true;
        relationshipEvidence.department_similarity = 1;
        relationshipEvidence.candidate_department = matchingDepartment;
        relationshipEvidence.target_department = matchingDepartment;
        addExplanation(
            relationshipEvidence,
            `Same department: ${matchingDepartment}`
        );
    }

    const locationMatch = compareLocations(profile.location || "", target.location || "");

    relationshipEvidence.candidate_location = profile.location || "";
    relationshipEvidence.target_location = target.location || "";
    relationshipEvidence.same_city = locationMatch.same_city;
    relationshipEvidence.same_state = locationMatch.same_state;
    relationshipEvidence.same_country = locationMatch.same_country;

    if (locationMatch.same_location) {
        relationshipEvidence.same_location = true;
        if (locationMatch.same_city) {
            addExplanation(relationshipEvidence, `Same city: ${locationMatch.candidate.city}`);
        } else if (locationMatch.same_state) {
            addExplanation(relationshipEvidence, `Same state: ${locationMatch.candidate.state}`);
        } else {
            addExplanation(relationshipEvidence, `Same country: ${locationMatch.candidate.country}`);
        }
    }

    const candidateSchool = cleanText(profile.education?.[0]?.school);
    const targetSchool = cleanText(target.education?.[0]?.school);
    const normalizedCandidateSchool = candidateSchool.toLowerCase();
    const normalizedTargetSchool = targetSchool.toLowerCase();

    relationshipEvidence.candidate_school = candidateSchool;
    relationshipEvidence.target_school = targetSchool;

    if (
        normalizedCandidateSchool &&
        normalizedTargetSchool &&
        normalizedCandidateSchool === normalizedTargetSchool
    ) {
        relationshipEvidence.same_school = true;
        addExplanation(
            relationshipEvidence,
            `Same school: ${candidateSchool}`
        );
    }

    relationshipEvidence.shared_skills = getSharedSkills(
        profile.skills || [],
        target.skills || []
    );

    for (const skill of relationshipEvidence.shared_skills) {
        addExplanation(relationshipEvidence, `Shared skill: ${skill}`);
    }

    const candidateText = [

        profile.headline,

        profile.about,

        profile.position,

        ...(profile.skills || []),

        ...(profile.experience || []).map(item => `${item.title} ${item.company}`)

    ]
        .join(" ")
        .toLowerCase();

    const targetText = [

        target.headline,

        target.about,

        target.position,

        ...(target.skills || []),

        ...(target.experience || []).map(item => `${item.title} ${item.company}`)

    ]
        .join(" ")
        .toLowerCase();

    const candidateTechnologies = matchTechnologies(candidateText);
    const targetTechnologies = matchTechnologies(targetText);

    relationshipEvidence.shared_technologies = getSharedList(
        candidateTechnologies,
        targetTechnologies
    );

    for (const technology of relationshipEvidence.shared_technologies) {
        addExplanation(relationshipEvidence, `Shared technology: ${technology}`);
    }

    relationshipEvidence.experience_overlap =
        candidateCompanies.filter(company =>
            targetCompanies.includes(company)
        );

    for (const company of relationshipEvidence.experience_overlap) {
        addExplanation(relationshipEvidence, `Experience overlap: ${company}`);
    }

    if (
        candidateCompanies.length > 0 &&
        targetCompanies.length > 0 &&
        relationshipEvidence.experience_overlap.length === 0
    ) {
        debugRelationshipComparison("experience_overlap failed", {
            reason: "No normalized company existed in both candidate and target company sets.",
            candidateCompanies,
            targetCompanies
        });
    }

    const candidateDegrees = uniqueValues(
        (profile.education || [])
            .map(item => cleanText(item.degree).toLowerCase())
            .filter(Boolean)
    );

    const targetDegrees = uniqueValues(
        (target.education || [])
            .map(item => cleanText(item.degree).toLowerCase())
            .filter(Boolean)
    );

    relationshipEvidence.education_overlap =
        candidateDegrees.filter(degree =>
            targetDegrees.includes(degree)
        );

    for (const degree of relationshipEvidence.education_overlap) {
        addExplanation(relationshipEvidence, `Education overlap: ${degree}`);
    }

    const connections = normalizeNumericField(profile.connections) || 0;

    const followers = normalizeNumericField(profile.followers) || 0;

    let networkStrength = 0;

    if (connections >= 500) {

        networkStrength += 70;

    } else if (connections >= 300) {

        networkStrength += 55;

    } else if (connections >= 100) {

        networkStrength += 35;

    } else {

        networkStrength += 15;

    }

    if (followers >= 1000) {

        networkStrength += 30;

    } else if (followers >= 500) {

        networkStrength += 20;

    } else if (followers >= 100) {

        networkStrength += 10;

    }

    relationshipEvidence.network_strength =
        Math.min(100, networkStrength);

    let relationshipStrength = 0;

    if (relationshipEvidence.same_company) {
        relationshipStrength += 30;
    }

    if (relationshipEvidence.current_employee) {
        relationshipStrength += 20;
        addExplanation(relationshipEvidence, "Current employee at target company");
    }

    relationshipStrength += Math.min(
        Math.round(relationshipEvidence.years_at_company * 2),
        10
    );

    if (relationshipEvidence.same_department) {
        relationshipStrength += 15;
    }

    if (relationshipEvidence.same_location) {
        relationshipStrength += 10;
    }

    if (relationshipEvidence.same_school) {
        relationshipStrength += 15;
    }

    relationshipStrength += Math.min(
        relationshipEvidence.shared_skills.length * 3,
        15
    );

    relationshipStrength += Math.min(
        relationshipEvidence.shared_technologies.length * 2,
        10
    );

    relationshipStrength += Math.min(
        relationshipEvidence.experience_overlap.length * 5,
        10
    );

    relationshipStrength += Math.min(
        relationshipEvidence.education_overlap.length * 3,
        5
    );

    relationshipStrength += Math.round(
        relationshipEvidence.network_strength * 0.05
    );

    relationshipEvidence.relationship_strength =
        Math.min(100, relationshipStrength);

    debugLog("relationship-score", "calculated relationship strength", {
        profile: profile.name,
        score: relationshipEvidence.relationship_strength,
        explanations: relationshipEvidence.explanations
    });

    const relationshipSummary = buildRelationshipSummary(
        profile,
        relationshipEvidence
    );

    return {

        ...profile,

        relationship_evidence: relationshipEvidence,

        relationship_summary: relationshipSummary

    };

}

module.exports = {
    buildRelationshipEvidence
};
