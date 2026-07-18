const assert = require("assert");

const { normalizeCompany } = require("../utils/CompanyNormalizer");
const { normalizeDepartment } = require("../utils/DepartmentNormalizer");
const { compareLocations, parseLocation } = require("../utils/LocationNormalizer");
const {
    buildSearchStrategies,
    chooseSearchStrategy,
    fullNameSearchStrategy
} = require("../utils/SearchStrategy");
const {
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
const { serializeFinalProfile } = require("../utils/FinalProfileSerializer");
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
    getTargetCompany
} = require("../scripts/search-pavel");

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
    const profile = buildRelationshipEvidence({
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
    const result = profile.relationship_evidence;

    assert.strictEqual(result.same_company, true);
    assert.strictEqual(result.current_employee, true);
    assert.ok(result.experience_overlap.includes("indpro"));
    assert.ok(result.shared_skills.includes("Node.js"));
    assert.ok(result.relationship_strength >= 60);
    assert.ok(result.explanations.length > 0);
    assert.ok(profile.relationship_summary.includes("Works at Indpro AB"));
    assert.ok(profile.relationship_summary.includes("Based in Bengaluru"));
    assert.ok(profile.relationship_summary.some(item => item.includes("Shared skills: Node.js")));
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
        education: [{ school: "Ramaiah College Of Arts, Science and Commerce" }],
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
            candidate_school: "Ramaiah College Of Arts, Science and Commerce",
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
        "Studied at Ramaiah College",
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
        company: "Indpro AB",
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
    assert.deepStrictEqual(
        Object.keys(merged).filter(key => !["createdAt", "url"].includes(key)).sort(),
        Object.keys(mutualProfileShape).sort()
    );
    assert.strictEqual(merged.followers, 1000);
    assert.strictEqual(merged.connections, 500);
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
            school: "Ramaiah College Of Arts, Science and Commerce",
            degree: "Bachelor of Science - BS",
            field_of_study: "Computer Science and Electronics",
            dates: "Nov 2021 - Jul 2024"
        },
        {
            school: "Ramaiah College Of Arts, Science and Commerce",
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
        current_company: "Indpro AB"
    };

    assert.strictEqual(getTargetCompany(target), "Indpro AB");
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
testBusinessDeveloperRoleClassification();
testTargetProfileMergeUsesMutualSchema();
testHeaderPositionExtraction();
testEducationDeduplication();
testSkillUiFiltering();
testBusinessSkillInference();
testCurrentExperienceAlignment();
testConnectionFilterTargetFields();

console.log("Validation tests passed.");
