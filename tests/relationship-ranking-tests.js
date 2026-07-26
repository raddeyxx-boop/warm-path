"use strict";
const assert = require("assert");
const { calculateRelationshipEvidenceScore, getRelationshipLabel, normalizeRelationshipEvidence,
    rankCandidates, score, verifiedEvidenceCount } = require("../utils/relationship-ranking");

function candidate(id, relationship, finalScore, evidence = {}) {
    return { id, final_score: finalScore, ai_analysis: {
        relationship_strength: { score: relationship }, credibility: { score: 50 },
        company_alignment: { score: 50 }, likelihood_of_reply: { score: 50 },
        introduction_quality: { score: 50 }, relationship_evidence: evidence,
    } };
}

assert.deepStrictEqual(rankCandidates([
    candidate("general-high", 40, 95), candidate("relationship-high", 40, 70, { same_company: true, current_employee: true }),
]).map(row => row.id), ["relationship-high", "general-high"]);
assert.strictEqual(score(candidate("all", 0, 70, { same_company: true, current_employee: true, same_department: true, same_location: true, same_school: true, shared_skills: ["a", "b"], shared_technologies: ["x"], experience_overlap: ["c"], education_overlap: ["d"], years_at_company: 2 })), 100);
assert.strictEqual(rankCandidates([candidate("b", 60, 70), candidate("a", 60, 70)])[0].id, "a");
assert.strictEqual(rankCandidates([candidate("none", null, 99), candidate("evidence", 40, 60, { same_company: true })])[0].id, "evidence");
assert.deepStrictEqual(rankCandidates([candidate("a", 0, 70, { same_company: true }), candidate("b", 0, 70, { same_location: true }), candidate("c", 0, 70, { same_school: true }), candidate("d", 0, 70)]).slice(0, 3).map(x => x.rank), [1, 2, 3]);
assert.strictEqual(calculateRelationshipEvidenceScore({ same_company: true }), 25);
assert.strictEqual(calculateRelationshipEvidenceScore({ current_employee: true }), 20);
assert.strictEqual(calculateRelationshipEvidenceScore({ same_department: true }), 12);
assert.ok(calculateRelationshipEvidenceScore({ same_location: true }) < calculateRelationshipEvidenceScore({ same_company: true }));
assert.strictEqual(calculateRelationshipEvidenceScore({ shared_skills: ["A", "B", null] }), 3);
assert.strictEqual(calculateRelationshipEvidenceScore({ shared_technologies: ["A", "B"] }), 2);
assert.strictEqual(normalizeRelationshipEvidence({ experience_overlap: { matched: true, value: "Indpro" } }).experience_overlap.matched, true);
assert.strictEqual(normalizeRelationshipEvidence({ education_overlap: "BBA" }).education_overlap.matched, true);
assert.strictEqual(calculateRelationshipEvidenceScore({ years_at_company: 99 }), 10);
assert.strictEqual(calculateRelationshipEvidenceScore(null), 0);
assert.strictEqual(getRelationshipLabel(80), "Strong");
assert.strictEqual(getRelationshipLabel(40), "Medium");
assert.strictEqual(getRelationshipLabel(39), "Weak");
assert.strictEqual(verifiedEvidenceCount({ same_company: { matched: true }, shared_skills: ["A"] }), 2);
const reasonRow = rankCandidates([candidate("reason", 0, 70, { same_school: true })])[0];
assert.match(reasonRow.top_candidate_reason.summary, /education connection/);
assert.doesNotMatch(reasonRow.top_candidate_reason.summary, /manual/i);
console.log("relationship ranking tests passed");
