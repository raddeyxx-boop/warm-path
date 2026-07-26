export const STRONG_RELATIONSHIP_THRESHOLD = 80

function structuredValue(value) {
  if (!value || typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function getRelationshipStrengthScore(candidate) {
  const persistedEvidenceScore = Number(candidate?.relationship_evidence_score ?? candidate?.relationship_rank_score)
  if (Number.isFinite(persistedEvidenceScore)) return persistedEvidenceScore
  const aiAnalysis = structuredValue(candidate?.ai_analysis)
  const relationshipStrength = structuredValue(candidate?.relationship_strength)
  const possibleValues = [
    candidate?.relationship_strength_score,
    aiAnalysis?.relationship_evidence_score,
    relationshipStrength?.score,
    aiAnalysis?.relationship_strength?.score,
  ]
  for (const rawScore of possibleValues) {
    if (rawScore === null || rawScore === undefined || rawScore === '') continue
    const score = Number(rawScore)
    if (Number.isFinite(score)) return score >= 0 && score <= 1 ? score * 100 : score
  }
  return null
}

export function countStrongRelationships(candidates, threshold = STRONG_RELATIONSHIP_THRESHOLD) {
  return (candidates || []).filter((candidate) => {
    const score = getRelationshipStrengthScore(candidate)
    return score !== null && score >= threshold
  }).length
}
