const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    FINAL_PROFILE_FIELDS,
    RELATIONSHIP_EVIDENCE_FIELDS,
    serializeFinalProfile,
    serializeFinalProfiles,
    validateClassifiedCandidates
} = require("../utils/FinalProfileSerializer");
const { writeJsonAtomicSync } = require("../utils/JsonFileStore");

const EXPERIENCE_KEYS = ["company", "title", "duration"];
const DURATION_KEYS = ["start", "end", "currently_working"];
const EDUCATION_KEYS = ["school", "degree", "field_of_study", "dates", "activities", "honors"];

function completeInput() {
    return {
        name: " Ayush Pal ", linkedin_url: "https://www.linkedin.com/in/ayush/", headline: " Engineer ",
        location: "Bengaluru", about: "Profile", company: "Indpro AB", current_company: "Indpro AB", position: "Engineer",
        followers: "485", connections: "448",
        experience: [{ company: "Indpro AB", title: "Engineer", duration: { start: "2025-09", end: null, currently_working: true }, ignored: true }],
        education: [{ school: "Ramaiah College", degree: "BCA", field_of_study: "Computer Science", dates: "2022 - 2025", activities: "Club", honors: "Distinction", ignored: true }],
        skills: ["React.js", " React.js ", "Node.js", "", { name: "ignored" }],
        technologies: ["React", " TypeScript ", "React"],
        relationship_evidence: {
            same_company: true, same_location: false, same_school: true, same_department: false,
            shared_skills: ["Leadership"], shared_technologies: ["TypeScript"],
            experience_overlap: { matched_companies: ["Indpro AB"], overlap_years: 2 },
            education_overlap: ["BCA"], department_similarity: "0.75",
            years_at_company: "4.8", current_employee: true, ignored: true
        },
        relationship_summary: ["Works at Indpro AB", " Works at Indpro AB ", "Engineering role", ""],
        role: "Engineering", seniority: "Mid", decision_power: "Low", hiring_influence: "Low"
    };
}

function assertCanonicalOrder(candidate) {
    assert.deepStrictEqual(Object.keys(candidate), FINAL_PROFILE_FIELDS);
    if (candidate.relationship_evidence !== null) {
        assert.deepStrictEqual(Object.keys(candidate.relationship_evidence), RELATIONSHIP_EVIDENCE_FIELDS);
    }
    candidate.experience.forEach(entry => {
        assert.deepStrictEqual(Object.keys(entry), EXPERIENCE_KEYS);
        assert.deepStrictEqual(Object.keys(entry.duration), DURATION_KEYS);
    });
    candidate.education.forEach(entry => assert.deepStrictEqual(Object.keys(entry), EDUCATION_KEYS));
}

function testCompleteCandidateAndOrder() {
    const candidate = serializeFinalProfile(completeInput());
    assertCanonicalOrder(candidate);
    assert.strictEqual(candidate.followers, 485);
    assert.strictEqual(candidate.connections, 448);
    assert.deepStrictEqual(candidate.skills, ["React.js", "Node.js"]);
    assert.deepStrictEqual(candidate.technologies, ["React", "TypeScript"]);
    assert.strictEqual(candidate.company, "Indpro AB");
    assert.deepStrictEqual(candidate.relationship_evidence.experience_overlap, {
        matched_companies: ["Indpro AB"], overlap_years: 2
    });
    assert.strictEqual(candidate.experience[0].ignored, undefined);
    assert.strictEqual(candidate.education[0].ignored, undefined);
    assert.strictEqual(candidate.relationship_evidence.ignored, undefined);
    assert.strictEqual(validateClassifiedCandidates([candidate]), true);
}

function testMissingOptionalDataAndEvidenceDefaults() {
    const candidate = serializeFinalProfile({ name: "Minimal" });
    assert.strictEqual(candidate.about, "");
    assert.strictEqual(candidate.followers, null);
    assert.strictEqual(candidate.connections, null);
    assert.deepStrictEqual(candidate.experience, []);
    assert.deepStrictEqual(candidate.education, []);
    assert.deepStrictEqual(candidate.skills, []);
    assert.deepStrictEqual(candidate.technologies, []);
    assert.deepStrictEqual(candidate.relationship_summary, []);
    assert.strictEqual(candidate.relationship_evidence, null);
    assertCanonicalOrder(candidate);
}

function testFalseZeroAndNumericNormalization() {
    const candidate = serializeFinalProfile(completeInput());
    assert.strictEqual(candidate.relationship_evidence.same_location, false);
    assert.strictEqual(candidate.relationship_evidence.same_department, false);
    assert.strictEqual(candidate.relationship_evidence.department_similarity, 0.75);
    assert.strictEqual(candidate.relationship_evidence.years_at_company, 4.8);

    const invalid = serializeFinalProfile({
        followers: "unknown", connections: "",
        relationship_evidence: {
            same_company: false, same_location: false, same_school: false, same_department: false,
            shared_skills: [], shared_technologies: [], experience_overlap: [], education_overlap: [],
            department_similarity: "invalid", years_at_company: null, current_employee: false
        }
    });
    assert.strictEqual(invalid.followers, null);
    assert.strictEqual(invalid.connections, null);
    assert.strictEqual(invalid.relationship_evidence.department_similarity, null);
    assert.strictEqual(invalid.relationship_evidence.years_at_company, null);
}

function testMalformedNestedArraysNormalizeSafely() {
    const candidate = serializeFinalProfile({
        experience: "not-an-array", education: null, skills: "React.js, Node.js",
        technologies: "React, Node.js", relationship_summary: { text: "bad" }
    });
    assert.deepStrictEqual(candidate.experience, []);
    assert.deepStrictEqual(candidate.education, []);
    assert.deepStrictEqual(candidate.skills, []);
    assert.deepStrictEqual(candidate.technologies, []);
    assert.deepStrictEqual(candidate.relationship_summary, []);

    const nested = serializeFinalProfile({
        experience: [null, "bad", { company: 42, title: null, duration: "invalid" }],
        education: [false, { school: "School" }]
    });
    assert.deepStrictEqual(nested.experience[0], { company: "", title: "", duration: { start: "", end: null, currently_working: false } });
    assert.deepStrictEqual(nested.education[0], { school: "School", degree: "", field_of_study: "", dates: "", activities: "", honors: "" });
    assertCanonicalOrder(nested);
}

function testValidationRejectsMalformedCandidates() {
    const candidate = serializeFinalProfile({ name: "Broken", relationship_evidence: completeInput().relationship_evidence });
    const missingEvidenceKey = { ...candidate, relationship_evidence: { ...candidate.relationship_evidence } };
    delete missingEvidenceKey.relationship_evidence.current_employee;
    assert.throws(() => validateClassifiedCandidates([missingEvidenceKey]), /relationship_evidence keys must be exactly/);
    assert.throws(() => validateClassifiedCandidates({ candidates: [] }), /root must be an array/);
    assert.throws(() => validateClassifiedCandidates([{ ...candidate, connections: "500+" }]), /connections must be a finite number or null/);
}

function testNullEvidenceAndJsonSafety() {
    const candidate = serializeFinalProfile({
        name: "Candidate", company: { name: "Example Corp", domain: "example.test" },
        technologies: [], relationship_evidence: null
    });
    assert.deepStrictEqual(candidate.company, { name: "Example Corp", domain: "example.test" });
    assert.strictEqual(candidate.relationship_evidence, null);
    assert.doesNotThrow(() => JSON.stringify(candidate));

    const circular = {};
    circular.self = circular;
    assert.throws(() => serializeFinalProfile({
        relationship_evidence: {
            same_company: false, same_location: false, same_school: false, same_department: false,
            shared_skills: [], shared_technologies: [], experience_overlap: circular,
            education_overlap: [], current_employee: false
        }
    }), /circular reference/);
}

function testJsonFileIntegration() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "warm-path-classified-contract-"));
    const outputPath = path.join(directory, "mutual-details-classified.json");
    try {
        const candidates = serializeFinalProfiles([completeInput(), { name: "Minimal" }]);
        validateClassifiedCandidates(candidates);
        writeJsonAtomicSync(outputPath, candidates);
        const text = fs.readFileSync(outputPath, "utf8");
        const parsed = JSON.parse(text);
        assert.ok(text.endsWith("\n"));
        assert.ok(Array.isArray(parsed));
        assert.strictEqual(validateClassifiedCandidates(parsed), true);
        parsed.forEach(assertCanonicalOrder);
        assert.deepStrictEqual(parsed.map(Object.keys), parsed.map(() => FINAL_PROFILE_FIELDS));
    } finally {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.rmdirSync(directory);
    }
}

testCompleteCandidateAndOrder();
testMissingOptionalDataAndEvidenceDefaults();
testFalseZeroAndNumericNormalization();
testMalformedNestedArraysNormalizeSafely();
testValidationRejectsMalformedCandidates();
testNullEvidenceAndJsonSafety();
testJsonFileIntegration();
console.log("Classified candidate contract tests passed.");
