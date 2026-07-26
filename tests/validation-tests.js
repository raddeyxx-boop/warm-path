const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { validateN8NPayloadContext } = require("../scripts/send-to-n8n");

const { normalizeCompany } = require("../utils/CompanyNormalizer");
const { normalizeDepartment } = require("../utils/DepartmentNormalizer");
const { compareLocations, parseLocation } = require("../utils/LocationNormalizer");
const {
    buildSearchStrategies,
    chooseSearchStrategy,
    fullNameSearchStrategy
} = require("../utils/SearchStrategy");
const {
    employmentFromHeadline,
    scoreProfileSuggestion
} = require("../utils/ProfileVerification");
const {
    LINKEDIN_FEED_COMMENTS,
    resetRecentComments,
    selectRandomComment
} = require("../utils/CommentRandomizer");
const {
    cleanDurationText,
    isIgnorableDurationLine,
    parseDurationRange,
    yearsFromDuration
} = require("../utils/DurationParser");
const {
    normalizeNumericField
} = require("../utils/NumericNormalizer");
const { ALL_TECHNOLOGIES, matchTechnologies } = require("../utils/TechnologyDictionary");
const { buildRelationshipEvidence } = require("../scripts/Relationship-Evidence");
const { classifyProfile } = require("../scripts/role-classifier");
const { serializeFinalProfile, serializeRelationshipEvidence } = require("../utils/FinalProfileSerializer");
const { mergeTargetProfile } = require("../utils/mergeTargetProfile");
const { derivePositionFromHeadline } = require("../scripts/extractors/header");
const { dedupeEducationRecords } = require("../scripts/extractors/education");
const { filterSkillValues } = require("../scripts/extractors/skills");
const {
    matchBusinessSkills
} = require("../scripts/extractors/skills");
const {
    ensureCurrentExperienceMatchesHeader
} = require("../scripts/scrape-profile-details");
const {
    isSuitableProfessionalPost
} = require("../scripts/HumanActivity");
const {
    getTargetCompany,
    getTargetSchool,
    prepareSearchBox
} = require("../scripts/search-pavel");
const { parseArgs } = require("../index");

async function testPrepareSearchBoxUsesHumanPointerAndKeyboardClear() {
    const calls = [];
    const searchBox = {
        waitFor: async options => calls.push(["waitFor", options]),
        scrollIntoViewIfNeeded: async () => calls.push(["scrollIntoViewIfNeeded"]),
        click: async options => calls.push(["click", options]),
        press: async key => calls.push(["press", key]),
        page: () => ({ waitForTimeout: async () => calls.push(["waitForTimeout"]) })
    };

    await prepareSearchBox(searchBox);
    assert.deepStrictEqual(calls.slice(0, 3).map(call => call[0]), ["waitFor", "scrollIntoViewIfNeeded", "click"]);
    assert.deepStrictEqual(calls.filter(call => call[0] === "press").map(call => call[1]), [
        process.platform === "darwin" ? "Meta+A" : "Control+A",
        "Backspace"
    ]);
    assert.strictEqual(calls.some(call => call[0] === "fill"), false);
}

function testCompanyNormalization() {
    assert.strictEqual(normalizeCompany("Indpro AB"), "indpro");
    assert.strictEqual(normalizeCompany("INDPRO Pvt. Ltd."), "indpro");
    assert.strictEqual(normalizeCompany("Indpro Private Limited"), "indpro");
}

function testDepartmentNormalization() {
    assert.strictEqual(normalizeDepartment("Backend Software Engineer"), "backend");
    assert.strictEqual(normalizeDepartment("Talent Acquisition Lead"), "hr");
    assert.strictEqual(normalizeDepartment("Customer Success Manager"), "customer success");
    assert.strictEqual(normalizeDepartment("Business developer"), "business development");
}

function testLocationNormalization() {
    const match = compareLocations(
        "Bengaluru, Karnataka, India",
        "Bengaluru, Karnataka, Bharat"
    );

    assert.strictEqual(match.same_city, true);
    assert.strictEqual(match.same_state, true);
    assert.strictEqual(match.same_country, true);
    assert.strictEqual(match.same_location, true);

    const linkedInAreaMatch = compareLocations(
        "Bengaluru, Karnataka, India",
        "Greater Bengaluru Area"
    );

    assert.deepStrictEqual(parseLocation("Bengaluru, Karnataka, India"), {
        raw: "Bengaluru, Karnataka, India",
        city: "bengaluru",
        state: "karnataka",
        country: "india",
        region: null,
        normalized: "bengaluru, karnataka, india"
    });
    assert.deepStrictEqual(parseLocation("Greater Bengaluru Area"), {
        raw: "Greater Bengaluru Area",
        city: "bengaluru",
        state: "karnataka",
        country: "india",
        region: "greater bengaluru area",
        normalized: "bengaluru, karnataka, india"
    });
    assert.strictEqual(linkedInAreaMatch.same_city, true);
    assert.strictEqual(linkedInAreaMatch.same_state, true);
    assert.strictEqual(linkedInAreaMatch.same_country, true);
    assert.strictEqual(linkedInAreaMatch.same_location, true);

    const linkedInAreaExamples = [
        ["Chennai, Tamil Nadu, India", "Greater Chennai Area"],
        ["Hyderabad, Telangana, India", "Greater Hyderabad Area"],
        ["New Delhi, Delhi, India", "Greater Delhi Area"],
        ["San Francisco, California, USA", "San Francisco Bay Area"],
        ["London, England, United Kingdom", "Greater London Area"],
        ["New York, New York, United States", "New York City Metropolitan Area"]
    ];

    linkedInAreaExamples.forEach(([candidate, target]) => {
        const areaMatch = compareLocations(candidate, target);

        assert.strictEqual(areaMatch.same_city, true);
        assert.strictEqual(areaMatch.same_state, true);
        assert.strictEqual(areaMatch.same_country, true);
        assert.strictEqual(areaMatch.same_location, true);
    });

    const stockholmMatch = compareLocations(
        "Stockholm, Sweden",
        "Greater Stockholm Area"
    );

    assert.strictEqual(stockholmMatch.same_city, true);
    assert.strictEqual(stockholmMatch.same_state, false);
    assert.strictEqual(stockholmMatch.same_country, true);
    assert.strictEqual(stockholmMatch.same_location, true);
}

function testHumanSearchStrategies() {
    const strategies = buildSearchStrategies("Uttam Kumar Maharana");
    const strategyByType = Object.fromEntries(
        strategies.map(strategy => [strategy.type, strategy.query])
    );

    assert.strictEqual(strategyByType.full_name, "Uttam Kumar Maharana");
    assert.strictEqual(strategyByType.first_middle, "Uttam Kumar");
    assert.strictEqual(strategyByType.first_name, "Uttam");
    assert.strictEqual(strategyByType.first_last, "Uttam Maharana");
    assert.ok(/^Utt/.test(strategyByType.partial));
    assert.ok("Uttam".startsWith(strategyByType.partial));
    assert.deepStrictEqual(fullNameSearchStrategy(" Uttam Kumar Maharana "), {
        type: "full_name",
        label: "full name",
        query: "Uttam Kumar Maharana"
    });

    const avoided = chooseSearchStrategy("Uttam Kumar Maharana", {
        searchStrategyWeights: {
            full_name: 100,
            first_middle: 100,
            first_name: 100,
            first_last: 100,
            partial: 100
        }
    }, {
        avoidType: "full_name"
    });

    assert.notStrictEqual(avoided.type, "full_name");
}

function testProfileVerification() {
    assert.deepStrictEqual(employmentFromHeadline("Software Engineer at Indpro AB"), {
        position: "Software Engineer",
        company: "Indpro AB"
    });
    assert.deepStrictEqual(employmentFromHeadline("Software Engineer | React"), {
        position: "",
        company: ""
    });
    const normalizeProfileUrl = value => {
        const url = new URL(value, "https://www.linkedin.com");

        return "https://www.linkedin.com" + url.pathname.replace(/\/?$/, "/");
    };
    const expectedProfile = {
        name: "Uttam Kumar Maharana",
        linkedin_url: "https://www.linkedin.com/in/uttamkumar-dev/",
        company: "Indpro",
        headline: "Software Engineer",
        location: "Bengaluru"
    };
    const exactUrlScore = scoreProfileSuggestion({
        href: "https://www.linkedin.com/in/uttamkumar-dev/?miniProfileUrn=abc",
        text: "Different visible text"
    }, expectedProfile, {
        normalizeProfileUrl,
        threshold: 95
    });

    assert.strictEqual(exactUrlScore.score, 100);
    assert.strictEqual(exactUrlScore.verified, true);
    assert.strictEqual(exactUrlScore.exactUrl, true);

    const strongTextWrongUrl = scoreProfileSuggestion({
        href: "https://www.linkedin.com/in/someone-else/",
        text: "Uttam Kumar Maharana Software Engineer Indpro Bengaluru"
    }, expectedProfile, {
        normalizeProfileUrl,
        threshold: 80
    });

    assert.ok(strongTextWrongUrl.score >= 80);
    assert.strictEqual(strongTextWrongUrl.verified, false);
    assert.deepStrictEqual(strongTextWrongUrl.fieldChecks, {
        name: true,
        company: true,
        headline: true,
        location: true,
        position: false
    });
    assert.deepStrictEqual(strongTextWrongUrl.fieldMatches, {
        name: true,
        company: true,
        headline: true,
        location: true,
        position: false
    });

    const nameOnly = scoreProfileSuggestion({
        href: "https://www.linkedin.com/in/someone-else/",
        text: "Uttam Kumar Maharana"
    }, expectedProfile, {
        normalizeProfileUrl,
        threshold: 80
    });

    assert.deepStrictEqual(nameOnly.fieldMatches, {
        name: true,
        company: false,
        headline: false,
        location: false,
        position: false
    });

    const derivedEmployment = scoreProfileSuggestion({
        href: "https://www.linkedin.com/in/someone-else/",
        text: "Jnanesha V G Accounts Executive at Indpro"
    }, {
        name: "Jnanesha V G",
        headline: "Accounts Executive at Indpro"
    }, { normalizeProfileUrl, threshold: 80 });
    assert.deepStrictEqual(derivedEmployment.fieldChecks, {
        name: true,
        company: true,
        headline: true,
        location: false,
        position: true
    });
    assert.deepStrictEqual(derivedEmployment.fieldMatches, {
        name: true,
        company: true,
        headline: true,
        location: false,
        position: true
    });
}

function testCommentRandomization() {
    resetRecentComments();

    const selected = new Set();
    let previousComment = "";

    assert.ok(LINKEDIN_FEED_COMMENTS.length > 150);

    for (let i = 0; i < 30; i++) {
        const comment = selectRandomComment({
            recentWindow: 20
        });

        assert.notStrictEqual(comment, previousComment);
        selected.add(comment);
        previousComment = comment;
    }

    assert.ok(selected.size >= 25);
    assert.ok([...selected].every(comment => LINKEDIN_FEED_COMMENTS.includes(comment)));
}

function testCommentQualityFilter() {
    assert.strictEqual(
        isSuitableProfessionalPost(
            "This is a practical framework for product teams using AI to improve engineering workflows and customer outcomes."
        ),
        true
    );
    assert.strictEqual(
        isSuitableProfessionalPost("We are hiring! Send your CV for this open role today."),
        false
    );
    assert.strictEqual(
        isSuitableProfessionalPost("Rest in peace. Sending condolences to the family."),
        false
    );
    assert.strictEqual(
        isSuitableProfessionalPost("Election politics and government conflict dominated the debate today."),
        false
    );
}

function testDurationParser() {
    assert.deepStrictEqual(parseDurationRange("November 2024 - Present"), {
        start: "2024-11",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("Jan 2024 - Jan 2025"), {
        start: "2024-01",
        end: "2025-01",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("jan-2024 - jan-2025"), {
        start: "2024-01",
        end: "2025-01",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("Jan/2024 - Jan/2025"), {
        start: "2024-01",
        end: "2025-01",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("January 2024 - January 2025"), {
        start: "2024-01",
        end: "2025-01",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("Aug 2024 \u2013 Present"), {
        start: "2024-08",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("January 2024 \u2013 June 2025"), {
        start: "2024-01",
        end: "2025-06",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("2024 - 2025"), {
        start: "2024-01",
        end: "2025-01",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("2022 \u2013 Present"), {
        start: "2022-01",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("2022 \u2013 2024"), {
        start: "2022-01",
        end: "2024-01",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("Jan 2024 - Present"), {
        start: "2024-01",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("January 2024 - Current"), {
        start: "2024-01",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("2024 - Now"), {
        start: "2024-01",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("2024 - Current Position"), {
        start: "2024-01",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("Jan 2024 - Today"), {
        start: "2024-01",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("Jan 2024 \u2013 Present"), {
        start: "2024-01",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("Jan 2024 \u2014 Present"), {
        start: "2024-01",
        end: null,
        currently_working: true
    });
    assert.strictEqual(
        cleanDurationText("Mar 2026 - Present \u00b7 5 mos"),
        "Mar 2026 - Present"
    );
    assert.deepStrictEqual(parseDurationRange("Mar 2026 - Present \u00b7 5 mos"), {
        start: "2026-03",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("Jan 2024 - Dec 2025 \u00b7 2 yrs"), {
        start: "2024-01",
        end: "2025-12",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("Jun 2023 - Mar 2025 \u00b7 1 yr 10 mos"), {
        start: "2023-06",
        end: "2025-03",
        currently_working: false
    });
    assert.deepStrictEqual(parseDurationRange("Apr 2025 - Current \u00b7 3 mos"), {
        start: "2025-04",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("Jun 2024 - Now ? 1 yr 2 mos"), {
        start: "2024-06",
        end: null,
        currently_working: true
    });
    assert.strictEqual(isIgnorableDurationLine("Full-time"), true);
    assert.strictEqual(isIgnorableDurationLine("On-site"), true);
    assert.strictEqual(isIgnorableDurationLine("1 yr 2 mos"), true);
    assert.deepStrictEqual(parseDurationRange({
        start: "Aug 2024",
        end: "Present",
        currently_working: false
    }), {
        start: "2024-08",
        end: null,
        currently_working: true
    });
    assert.deepStrictEqual(parseDurationRange("Not a date - Still not a date"), {
        start: null,
        end: null,
        currently_working: false
    });
    assert.strictEqual(yearsFromDuration({
        start: "2024-01",
        end: "2025-01",
        currently_working: false
    }), 1);
}

function testNumericNormalization() {
    assert.strictEqual(normalizeNumericField("100 followers"), 100);
    assert.strictEqual(normalizeNumericField("100"), 100);
    assert.strictEqual(normalizeNumericField("1,234"), 1234);
    assert.strictEqual(normalizeNumericField("12,500 followers"), 12500);
    assert.strictEqual(normalizeNumericField("0"), 0);
    assert.strictEqual(normalizeNumericField("500+ connections"), 500);
    assert.strictEqual(normalizeNumericField("1.3k followers"), 1300);
    assert.strictEqual(normalizeNumericField("unknown"), null);
    assert.strictEqual(normalizeNumericField(""), null);
}

function testTechnologyExtraction() {
    assert.ok(ALL_TECHNOLOGIES.length > 500);
    const technologies = matchTechnologies("Built APIs with React, Node.js, PostgreSQL, Docker, and AWS Lambda.");

    assert.ok(technologies.includes("React"));
    assert.ok(technologies.includes("PostgreSQL"));
    assert.ok(technologies.some(item => item.includes("Lambda")));
}

function testRelationshipEngine() {
    const exactCurrentMatch = buildRelationshipEvidence({
        name: "Candidate",
        current_company: "Indpro AB",
        location: "Bengaluru, Karnataka, India",
        position: "Software Engineer",
        experience: [{
            company: "Indpro AB",
            title: "Software Engineer",
            duration: {
                start: "2025-04",
                end: null,
                currently_working: true
            }
        }],
        skills: ["Node.js", "PostgreSQL"]
    }, {
        name: "Gurupreet Singh",
        company: "Indpro",
        location: "Bengaluru, Karnataka, India",
        position: "Backend Engineer",
        skills: ["Node.js"]
    });
    const result = exactCurrentMatch.relationship_evidence;

    assert.strictEqual(result.same_company, true);
    assert.strictEqual(result.current_employee, true);
    assert.ok(result.years_at_company > 0);
    assert.ok(result.experience_overlap.includes("indpro"));
    assert.ok(result.shared_skills.includes("Node.js"));
    assert.ok(result.relationship_strength >= 60);
    assert.ok(result.explanations.length > 0);
    assert.ok(exactCurrentMatch.relationship_summary.includes("Works at Indpro AB"));
    assert.ok(exactCurrentMatch.relationship_summary.includes("Based in Bengaluru"));
    assert.ok(exactCurrentMatch.relationship_summary.some(item => item.includes("Shared skills: Node.js")));

    const historicalOnly = buildRelationshipEvidence({
        name: "Historical Candidate",
        current_company: "Byggmax AB",
        experience: [{
            company: "Indpro AB",
            duration: { start: "2020-01", end: "2022-01", currently_working: false }
        }]
    }, { company: "Indpro" });
    assert.strictEqual(historicalOnly.relationship_evidence.same_company, false);
    assert.strictEqual(historicalOnly.relationship_evidence.current_employee, false);
    assert.strictEqual(historicalOnly.relationship_evidence.years_at_company, 0);
    assert.deepStrictEqual(historicalOnly.relationship_evidence.experience_overlap, ["indpro"]);

    const contradictoryCurrentRows = buildRelationshipEvidence({
        name: "Renu Gangwar",
        current_company: "Byggmax AB",
        experience: [
            {
                company: "Byggmax AB",
                duration: { start: "2023-09", end: null, currently_working: true }
            },
            {
                company: "Indpro AB",
                duration: { start: "2016-11", end: null, currently_working: true }
            }
        ]
    }, { company: "Indpro" });
    assert.strictEqual(contradictoryCurrentRows.relationship_evidence.same_company, false);
    assert.strictEqual(contradictoryCurrentRows.relationship_evidence.current_employee, false);
    assert.strictEqual(contradictoryCurrentRows.relationship_evidence.years_at_company, 0);
    assert.deepStrictEqual(
        contradictoryCurrentRows.relationship_evidence.experience_overlap,
        ["indpro"]
    );

    const normalizedMatch = buildRelationshipEvidence({
        name: "Normalized Match",
        current_company: "INDPRO AB"
    }, { current_company: "indpro" });
    assert.strictEqual(normalizedMatch.relationship_evidence.same_company, true);
    assert.strictEqual(normalizedMatch.relationship_evidence.current_employee, true);

    const noTargetCompany = buildRelationshipEvidence({
        name: "No Target Company",
        current_company: "Byggmax AB"
    }, { name: "Target" });
    assert.strictEqual(noTargetCompany.relationship_evidence.same_company, false);
    assert.strictEqual(noTargetCompany.relationship_evidence.current_employee, false);
    assert.strictEqual(noTargetCompany.relationship_evidence.years_at_company, 0);
}

function testFinalProfileSerializer() {
    const profile = serializeFinalProfile({
        name: "Candidate",
        linkedin_url: "https://www.linkedin.com/in/candidate/",
        headline: "Engineer",
        location: "Bengaluru, India",
        about: "About",
        current_company: "Indpro AB",
        position: "Business developer",
        followers: "1,304 followers",
        connections: "20",
        experience: [{
            title: "Business developer",
            company: "Indpro AB",
            duration: "jan-2024 - jan-2025"
        }],
        education: [{ school: "Stanford University" }],
        skills: [],
        has_about: true,
        role: "Business Development",
        role_confidence: 0.99,
        seniority: "Mid",
        seniority_score: 40,
        decision_power: "Low",
        decision_power_score: 20,
        hiring_influence: "Low",
        relationship_evidence: {
            same_company: true,
            company_name: "Indpro AB",
            same_location: true,
            candidate_location: "Bengaluru, Karnataka, India",
            same_school: true,
            candidate_school: "Stanford University",
            same_department: false,
            department_similarity: 0.8,
            years_at_company: 0.7,
            relationship_strength: 60,
            explanations: ["Worked together at Indpro AB"],
            internal_debug: true
        }
    });

    assert.deepStrictEqual(Object.keys(profile), [
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
    ]);
    assert.strictEqual(profile.connection, undefined);
    assert.strictEqual(profile.role_confidence, undefined);
    assert.strictEqual(profile.seniority_score, undefined);
    assert.strictEqual(profile.relationship_evidence.internal_debug, undefined);
    assert.strictEqual(profile.relationship_evidence.same_company, true);
    assert.strictEqual(profile.relationship_evidence.department_similarity, 0.8);
    assert.strictEqual(profile.relationship_evidence.years_at_company, 0.7);
    assert.strictEqual(profile.followers, 1304);
    assert.strictEqual(typeof profile.followers, "number");
    assert.strictEqual(profile.connections, 20);
    assert.deepStrictEqual(profile.experience[0].duration, {
        start: "2024-01",
        end: "2025-01",
        currently_working: false
    });
    assert.deepStrictEqual(profile.relationship_summary, [
        "Works at Indpro AB",
        "Based in Bengaluru",
        "Studied at Stanford University",
        "Business Development role"
    ]);

    const unknownFollowersProfile = serializeFinalProfile({
        name: "Candidate",
        followers: "not available",
        experience: [],
        relationship_evidence: {}
    });

    assert.strictEqual(unknownFollowersProfile.followers, null);

    const sourcedSummaryProfile = serializeFinalProfile({
        name: "Candidate",
        followers: "100",
        experience: [],
        role: "Engineering",
        relationship_evidence: {},
        relationship_summary: [
            "Works at Indpro AB",
            "Shared technologies: React"
        ]
    });

    assert.deepStrictEqual(sourcedSummaryProfile.relationship_summary, [
        "Works at Indpro AB",
        "Shared technologies: React",
        "Engineering role"
    ]);
}

function testRelationshipEvidenceSerializerContract() {
    const keys = [
        "same_company", "same_location", "same_school", "same_department",
        "shared_skills", "shared_technologies", "experience_overlap", "education_overlap",
        "department_similarity", "years_at_company", "current_employee"
    ];
    const current = serializeRelationshipEvidence({
        same_company: true, same_location: true, same_school: false,
        same_department: false, shared_skills: [], shared_technologies: [],
        experience_overlap: [], education_overlap: [], department_similarity: 0,
        years_at_company: 7.8, current_employee: true
    });
    assert.deepStrictEqual(Object.keys(current), keys);
    assert.deepStrictEqual(current, {
        same_company: true, same_location: true, same_school: false,
        same_department: false, shared_skills: [], shared_technologies: [],
        experience_overlap: [], education_overlap: [], department_similarity: 0,
        years_at_company: 7.8, current_employee: true
    });

    const former = serializeRelationshipEvidence({
        same_company: true, same_location: false, same_school: false,
        same_department: true, department_similarity: 1,
        years_at_company: 0, current_employee: false
    });
    assert.strictEqual(former.current_employee, false);
    assert.strictEqual(former.same_location, false);
    assert.strictEqual(former.years_at_company, 0);
    assert.strictEqual(serializeRelationshipEvidence(), null);
    assert.deepStrictEqual(serializeRelationshipEvidence({
        department_similarity: "0.8", years_at_company: "19.3"
    }).department_similarity, 0.8);
    assert.strictEqual(serializeRelationshipEvidence({
        department_similarity: "0.8", years_at_company: "19.3"
    }).years_at_company, 19.3);
    assert.deepStrictEqual(serializeRelationshipEvidence({
        department_similarity: "invalid", years_at_company: null
    }), {
        same_company: false, same_location: false, same_school: false,
        same_department: false, shared_skills: [], shared_technologies: [],
        experience_overlap: [], education_overlap: [], department_similarity: null,
        years_at_company: null, current_employee: false
    });
}

function testBusinessDeveloperRoleClassification() {
    const profile = classifyProfile({
        name: "Mukesh",
        headline: "Business developer at Indpro AB",
        position: "Business developer",
        experience: [{
            title: "Business developer",
            company: "Indpro AB"
        }]
    });

    assert.strictEqual(profile.role, "Business Development");
}

function testTargetProfileMergeUsesMutualSchema() {
    const target = {
        name: "Target",
        linkedin_name: "Target",
        company: "Indpro AB",
        company_filter: "Indpro AB",
        school_filter: "Stanford University",
        keywords: "automation",
        url: "https://www.linkedin.com/in/target/",
        createdAt: "2026-01-01T00:00:00.000Z",
        title: "Old lightweight title",
        h1Count: 1,
        bodyLength: 100
    };
    const mutualProfileShape = {
        name: "Target",
        linkedin_url: "https://www.linkedin.com/in/target/",
        headline: "Founder",
        location: "Bengaluru, Karnataka, India",
        about: "Full profile",
        current_company: "Indpro AB",
        position: "Founder",
        followers: "1000",
        connections: "500+",
        experience: [],
        education: [],
        skills: []
    };
    const merged = mergeTargetProfile(target, mutualProfileShape);

    assert.strictEqual(merged.title, undefined);
    assert.strictEqual(merged.h1Count, undefined);
    assert.strictEqual(merged.bodyLength, undefined);
    assert.strictEqual(merged.createdAt, target.createdAt);
    assert.strictEqual(merged.url, target.url);
    assert.strictEqual(merged.linkedin_name, "Target");
    assert.strictEqual(merged.linkedin_url, target.url);
    assert.strictEqual(merged.company, "Indpro AB");
    assert.strictEqual(merged.company_filter, "Indpro AB");
    assert.strictEqual(merged.school_filter, "Stanford University");
    assert.strictEqual(merged.keywords, "automation");
    assert.strictEqual(merged.followers, 1000);
    assert.strictEqual(merged.connections, 500);
}

function testTargetProfileMergeDoesNotDeriveSchoolFilter() {
    const merged = mergeTargetProfile({
        name: "Target",
        company: "Indpro AB",
        school_filter: null
    }, {
        name: "Target",
        current_company: "Indpro AB",
        education: [{ school: "Scraped School Must Not Become A Filter" }]
    });

    assert.strictEqual(merged.school_filter, "");
    assert.strictEqual(merged.education[0].school, "Scraped School Must Not Become A Filter");
}

function testHeaderPositionExtraction() {
    assert.strictEqual(
        derivePositionFromHeadline(
            "Revenue Operations Manager at Indpro AB | Driving Growth through Sales & Marketing Automation",
            "Indpro AB"
        ),
        "Revenue Operations Manager"
    );
}

function testEducationDeduplication() {
    const education = dedupeEducationRecords([
        {
            school: "Stanford University",
            degree: "Bachelor of Science - BS",
            field_of_study: "Computer Science and Electronics",
            dates: "Nov 2021 - Jul 2024"
        },
        {
            school: "Stanford University",
            degree: "Bachelor of Science - BS",
            field_of_study: "Computer Science and Electronics",
            dates: "2021 - Aug 2024"
        }
    ]);

    assert.strictEqual(education.length, 1);
}

function testSkillUiFiltering() {
    assert.deepStrictEqual(
        filterSkillValues([
            "Process Automation",
            "Endorse",
            "Show all 20 skills",
            "Management",
            "4 endorsements",
            "Connect"
        ]),
        ["Process Automation", "Management"]
    );
}

function testBusinessSkillInference() {
    const skills = matchBusinessSkills(
        "Revenue Operations Manager driving Sales Automation, Marketing Automation, Revenue Strategy, and Process Optimization."
    );

    assert.ok(skills.includes("Revenue Operations"));
    assert.ok(skills.includes("Sales Automation"));
    assert.ok(skills.includes("Marketing Automation"));
    assert.ok(skills.includes("Revenue Strategy"));
    assert.ok(skills.includes("Process Optimization"));

    const inferred = matchBusinessSkills(
        "Designing automation workflows for sales and marketing efforts while providing actionable insights, nurturing strategic alliances, and #BusinessDevelopment."
    );

    assert.ok(inferred.includes("Sales Automation"));
    assert.ok(inferred.includes("Marketing Automation"));
    assert.ok(inferred.includes("Workflow Automation"));
    assert.ok(inferred.includes("Data Analysis"));
    assert.ok(inferred.includes("Relationship Management"));
    assert.ok(inferred.includes("Business Development"));
}

function testCurrentExperienceAlignment() {
    const experience = ensureCurrentExperienceMatchesHeader([
        {
            company: "SAFEPRO AI VIDEO RESEARCH LABS PVT. LTD.",
            title: "Full Stack Developer",
            duration: {
                start: "2024-01",
                end: "2024-06",
                currently_working: false
            }
        }
    ], {
        current_company: "Indpro AB",
        position: "Revenue Operations Manager"
    });

    assert.strictEqual(experience.length, 1);
    assert.strictEqual(experience[0].company, "SAFEPRO AI VIDEO RESEARCH LABS PVT. LTD.");
    assert.strictEqual(experience[0].title, "Full Stack Developer");
}

function testConnectionFilterTargetFields() {
    const target = {
        company: "Indpro AB",
        current_company: "Indpro AB",
        education: [{ school: "Stanford University" }]
    };

    assert.strictEqual(getTargetCompany(target), "Indpro AB");
    assert.strictEqual(getTargetCompany({ current_company: "Scraped Company" }), "");
    assert.strictEqual(getTargetSchool(target), "");
    assert.strictEqual(getTargetSchool({ school_filter: "Stanford" }), "Stanford");
}

function testLegacyLinkedInUrlMapping() {
    const previous = process.env.WARM_PATH_TARGET_JSON;
    process.env.WARM_PATH_TARGET_JSON = JSON.stringify({
        name: "Gurupreet Singh",
        current_company: "Indpro AB",
        linkedin_name: "https://www.linkedin.com/in/gurupreet-singh-2344aa2bb/",
        company_filter: "Indpro AB"
    });

    try {
        const target = parseArgs(["node", "index.js"]);
        assert.strictEqual(target.linkedin_name, "Gurupreet Singh");
        assert.strictEqual(target.linkedin_url, "https://www.linkedin.com/in/gurupreet-singh-2344aa2bb/");
        assert.strictEqual(target.url, target.linkedin_url);
        assert.strictEqual(target.company, "Indpro AB");
    } finally {
        if (previous === undefined) delete process.env.WARM_PATH_TARGET_JSON;
        else process.env.WARM_PATH_TARGET_JSON = previous;
    }
}

function testHumanNavigationWorkflowInvariants() {
    const targetSearchSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "search-pavel.js"),
        "utf8"
    );
    const mutualSearchSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "scrape-profile-details.js"),
        "utf8"
    );
    const mutualFunction = mutualSearchSource.slice(
        mutualSearchSource.indexOf("async function findAndOpenProfile"),
        mutualSearchSource.indexOf("function profileMatchesTarget")
    );

    assert.doesNotMatch(targetSearchSource, /page\.goto\((?:connectionsUrl|expectedHref)/);
    assert.doesNotMatch(mutualFunction, /openLinkedInHome\s*\(/);
    assert.doesNotMatch(mutualFunction, /restoreMutualsPage|loadMutualsParentState/);
    assert.match(mutualFunction, /currentSearchBox/);
    assert.match(mutualFunction, /Searching next mutual from current profile/);
    assert.match(mutualFunction, /await runProfileSearch\(/);
    assert.match(mutualFunction, /normalizeProfileUrl\(page\.url\(\)\) !== expectedUrl/);
}

function testMutualOnlyFullScrollCycle() {
    const mutualSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "scrape-profile-details.js"),
        "utf8"
    );
    const targetSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "search-pavel.js"),
        "utf8"
    );
    const mutualReader = mutualSource.slice(
        mutualSource.indexOf("async function humanReadMutualProfile"),
        mutualSource.indexOf("async function humanReadProfile")
    );

    assert.match(mutualSource, /scrapeProfile\(page, \{ mutualProfile: true \}\)/);
    assert.doesNotMatch(targetSource, /mutualProfile:\s*true/);
    assert.match(mutualReader, /stableBottomCount < 3/);
    assert.match(mutualReader, /state\.scrollY <= 20/);
    assert.ok(
        mutualReader.indexOf("[MUTUAL] Bottom reached") <
        mutualReader.indexOf("[MUTUAL] Starting upward reading")
    );
    assert.ok(
        mutualReader.indexOf("[MUTUAL] Top reached") <
        mutualReader.indexOf("[MUTUAL] Human reading completed")
    );
}

function testTargetFullScrollCycleCompletesBeforeConnections() {
    const scraperSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "scrape-profile-details.js"),
        "utf8"
    );
    const targetSource = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "search-pavel.js"),
        "utf8"
    );
    const targetReader = scraperSource.slice(
        scraperSource.indexOf("async function humanReadTargetProfile"),
        scraperSource.indexOf("async function humanReadProfile")
    );

    assert.match(targetSource, /scrapeProfile\(page, \{ targetProfile: true \}\)/);
    assert.match(targetReader, /stableBottomCount < 3/);
    assert.match(targetReader, /state\.scrollY <= 20/);
    assert.ok(
        targetReader.indexOf("[TARGET] Bottom reached") <
        targetReader.indexOf("[TARGET] Starting upward reading")
    );
    assert.ok(
        targetReader.indexOf("[TARGET] Top reached") <
        targetReader.indexOf("[TARGET] Human reading completed")
    );
    assert.ok(
        targetSource.indexOf("await processTargetProfile") <
        targetSource.indexOf("[TARGET] Opening Connections page")
    );
    assert.match(scraperSource, /scrapeProfile\(page, \{ mutualProfile: true \}\)/);
}

function testMutualResultsHumanBrowsingCycle() {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "collect-mutuals.js"),
        "utf8"
    );
    const scrollFunction = source.slice(
        source.indexOf("async function scrollToBottom"),
        source.indexOf("async function getCurrentPageNumber")
    );
    const paginationFunction = source.slice(
        source.indexOf("async function goToNextPage"),
        source.indexOf("async function getPageSignature")
    );

    assert.match(scrollFunction, /await waitForVisibleResultsToSettle\(page, sourcePage\)/);
    assert.match(scrollFunction, /await returnResultsToTopNaturally\(page, scrollTarget, sourcePage\)/);
    assert.match(scrollFunction, /stableRounds >= LIMITS\.stableScrollRounds/);
    assert.doesNotMatch(scrollFunction, /scrollTop\s*=\s*element\.scrollHeight/);
    assert.match(paginationFunction, /Pagination verified and Next is visible/);
    assert.ok(
        paginationFunction.indexOf("await waitForLinkedInResultsPageChange") <
        paginationFunction.indexOf("Next results page loaded; top reset will run before browsing")
    );
}

function testN8NPayloadContextValidation() {
    const valid = {
        ownerUserId: "33333333-3333-4333-8333-333333333333",
        workflowRunId: "66666666-6666-4666-8666-666666666666",
        searchRequestId: "77777777-7777-4777-8777-777777777777",
        target: { name: "Ali Elsheik" }
    };
    assert.doesNotThrow(() => validateN8NPayloadContext(valid));
    assert.throws(() => validateN8NPayloadContext({ ...valid, ownerUserId: "" }), /OWNER_USER_ID is missing/);
    assert.throws(() => validateN8NPayloadContext({ ...valid, workflowRunId: "" }), /WORKFLOW_RUN_ID is missing/);
    assert.throws(() => validateN8NPayloadContext({ ...valid, searchRequestId: "" }), /SEARCH_REQUEST_ID is missing/);
    assert.throws(() => validateN8NPayloadContext({ ...valid, target: null }), /Target input is missing/);
    assert.throws(() => validateN8NPayloadContext({ ...valid, target: {} }), /Target name is missing/);
}

function testCurrentN8NExportPreservesRunContext() {
    const exported = JSON.parse(fs.readFileSync(
        path.join(__dirname, "..", "n8n_backup", "current-warm-path-clean-response.json"),
        "utf8"
    ));
    const workflow = Array.isArray(exported) ? exported[0] : exported;
    const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
    const splitCode = nodes.get("Split Profiles").parameters.jsCode;
    const reportCode = nodes.get("Build Final Report").parameters.jsCode;
    const candidateFields = nodes.get("Save Candidates").parameters.fieldsUi.fieldValues;
    const fieldMap = new Map(candidateFields.map(field => [field.fieldId, field.fieldValue]));

    for (const field of ["owner_user_id", "workflow_run_id", "search_request_id"]) {
        assert.match(splitCode, new RegExp(field));
        assert.match(reportCode, new RegExp(field));
    }
    assert.strictEqual(fieldMap.get("owner_user_id"), "={{ $('Webhook').first().json.body.owner_user_id }}");
    assert.strictEqual(fieldMap.get("workflow_run_id"), "={{ $('Webhook').first().json.body.workflow_run_id }}");
    assert.strictEqual(fieldMap.get("search_request_id"), "={{ $('Webhook').first().json.body.search_request_id }}");
    const deleteFields = nodes.get("Delete Old Candidates").parameters.filters.conditions.map(condition => condition.keyName);
    assert.deepStrictEqual(deleteFields, ["owner_user_id", "workflow_run_id"]);
    assert.deepStrictEqual(workflow.connections["Delete Old Candidates"].main, [[]]);
}

testCompanyNormalization();
testDepartmentNormalization();
testLocationNormalization();
testHumanSearchStrategies();
testProfileVerification();
testCommentRandomization();
testCommentQualityFilter();
testDurationParser();
testNumericNormalization();
testTechnologyExtraction();
testRelationshipEngine();
testFinalProfileSerializer();
testRelationshipEvidenceSerializerContract();
testBusinessDeveloperRoleClassification();
testTargetProfileMergeUsesMutualSchema();
testTargetProfileMergeDoesNotDeriveSchoolFilter();
testHeaderPositionExtraction();
testEducationDeduplication();
testSkillUiFiltering();
testBusinessSkillInference();
testCurrentExperienceAlignment();
testConnectionFilterTargetFields();
testLegacyLinkedInUrlMapping();
testHumanNavigationWorkflowInvariants();
testMutualOnlyFullScrollCycle();
testTargetFullScrollCycleCompletesBeforeConnections();
testMutualResultsHumanBrowsingCycle();
testN8NPayloadContextValidation();
testCurrentN8NExportPreservesRunContext();
testPrepareSearchBoxUsesHumanPointerAndKeyboardClear()
    .then(() => console.log("Validation tests passed."))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
