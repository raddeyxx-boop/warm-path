"use strict";

const STRONG_RELATIONSHIP_THRESHOLD = 80;
const MEDIUM_RELATIONSHIP_THRESHOLD = 40;

function objectValue(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
}

function matched(value) {
    const parsed = objectValue(value);
    if (parsed === true) return true;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return parsed.matched === true || parsed.match === true || parsed.value === true;
}

function normalizeList(value) {
    const parsed = objectValue(value);
    const source = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.values) ? parsed.values
        : Array.isArray(parsed?.items) ? parsed.items
        : parsed?.matched === true && parsed.value ? [parsed.value]
        : typeof parsed === "string" && parsed.trim() ? [parsed]
        : [];
    return [...new Set(source.map(item => String(item || "").trim()).filter(Boolean))];
}

function normalizeOverlap(value) {
    const values = normalizeList(value);
    return { matched: matched(value) || values.length > 0, values };
}

function rawRelationshipEvidence(candidate) {
    return objectValue(candidate?.relationship_evidence)
        || objectValue(candidate?.ai_analysis)?.relationship_evidence
        || objectValue(candidate?.analysis)?.relationship_evidence
        || {};
}

function normalizeRelationshipEvidence(rawEvidence = {}) {
    const evidence = objectValue(rawEvidence);
    const source = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {};
    return {
        same_company: matched(source.same_company),
        same_department: matched(source.same_department),
        same_location: matched(source.same_location),
        same_school: matched(source.same_school),
        shared_skills: normalizeList(source.shared_skills),
        shared_technologies: normalizeList(source.shared_technologies),
        experience_overlap: normalizeOverlap(source.experience_overlap),
        education_overlap: normalizeOverlap(source.education_overlap),
        current_employee: matched(source.current_employee),
        years_at_company: Math.max(0, Number.isFinite(Number(source.years_at_company)) ? Number(source.years_at_company) : 0),
    };
}

function calculateRelationshipEvidenceScore(rawEvidence) {
    const evidence = normalizeRelationshipEvidence(rawEvidence);
    let total = 0;
    if (evidence.same_company) total += 25;
    if (evidence.current_employee) total += 20;
    if (evidence.experience_overlap.matched) total += 15;
    if (evidence.same_department) total += 12;
    if (evidence.same_school) total += 10;
    if (evidence.education_overlap.matched) total += 8;
    if (evidence.same_location) total += 5;
    total += Math.min(evidence.shared_skills.length * 1.5, 6);
    total += Math.min(evidence.shared_technologies.length, 4);
    total += Math.min(evidence.years_at_company * 2, 10);
    return Math.round(Math.min(total, 100) * 100) / 100;
}

function verifiedEvidenceCount(rawEvidence) {
    const evidence = normalizeRelationshipEvidence(rawEvidence);
    return [evidence.same_company, evidence.same_department, evidence.same_location, evidence.same_school,
        evidence.current_employee, evidence.experience_overlap.matched, evidence.education_overlap.matched,
        evidence.shared_skills.length > 0, evidence.shared_technologies.length > 0,
        evidence.years_at_company > 0].filter(Boolean).length;
}

function getRelationshipLabel(score) {
    if (score >= STRONG_RELATIONSHIP_THRESHOLD) return "Strong";
    if (score >= MEDIUM_RELATIONSHIP_THRESHOLD) return "Medium";
    return "Weak";
}

function buildTopCandidateReason(candidate, rank) {
    const evidence = candidate.normalized_relationship_evidence;
    const reasons = [];
    if (evidence.same_company) reasons.push("works at the same company");
    if (evidence.current_employee) reasons.push("is a current employee");
    if (evidence.experience_overlap.matched) reasons.push("has verified experience overlap");
    if (evidence.same_department) reasons.push("has department alignment");
    if (evidence.same_school) reasons.push("shares an education connection");
    if (evidence.education_overlap.matched) reasons.push("has education overlap");
    if (evidence.same_location) reasons.push("shares the same location");
    if (evidence.shared_skills.length) reasons.push(`shares ${evidence.shared_skills.length} skill${evidence.shared_skills.length === 1 ? "" : "s"}`);
    if (evidence.shared_technologies.length) reasons.push(`shares ${evidence.shared_technologies.length} technolog${evidence.shared_technologies.length === 1 ? "y" : "ies"}`);
    if (evidence.years_at_company > 0) reasons.push(`has ${evidence.years_at_company} years at the company`);
    const detail = reasons.length ? reasons.join(", ") : "the strongest available relationship evidence";
    return { summary: `${candidate.name} ranked #${rank} because the evidence shows ${detail}, producing a relationship evidence score of ${candidate.relationship_evidence_score}.`, key_reasons: reasons };
}

function rankCandidates(candidates) {
    return [...candidates].map(candidate => {
        const normalized = normalizeRelationshipEvidence(rawRelationshipEvidence(candidate));
        const evidenceScore = calculateRelationshipEvidenceScore(normalized);
        return { ...candidate, normalized_relationship_evidence: normalized,
            relationship_evidence: rawRelationshipEvidence(candidate), relationship_evidence_score: evidenceScore,
            relationship_rank_score: evidenceScore, relationship_label: getRelationshipLabel(evidenceScore),
            verified_evidence_count: verifiedEvidenceCount(normalized) };
    }).sort((left, right) => right.relationship_evidence_score - left.relationship_evidence_score
        || right.verified_evidence_count - left.verified_evidence_count
        || (Number(right.final_score ?? right.score) || 0) - (Number(left.final_score ?? left.score) || 0)
        || String(left.id || left.linkedin_url || left.linkedin || "").localeCompare(String(right.id || right.linkedin_url || right.linkedin || "")))
        .map((candidate, index) => ({ ...candidate, rank: index + 1,
            top_candidate_reason: buildTopCandidateReason(candidate, index + 1) }));
}

module.exports = { STRONG_RELATIONSHIP_THRESHOLD, MEDIUM_RELATIONSHIP_THRESHOLD, buildTopCandidateReason,
    calculateRelationshipEvidenceScore, getRelationshipLabel, normalizeList, normalizeOverlap,
    normalizeRelationshipEvidence, rankCandidates, rawRelationshipEvidence, verifiedEvidenceCount,
    evidenceCount: verifiedEvidenceCount, score: candidate => calculateRelationshipEvidenceScore(rawRelationshipEvidence(candidate)) };
