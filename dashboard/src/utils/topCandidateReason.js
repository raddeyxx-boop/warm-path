import { fallback, formatScore, relationshipValue } from './format'

export function normalizeTopCandidateReason(value) {
  if (!value) return null

  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const title = normalizeText(parsed.title)
  const summary = normalizeText(parsed.summary)
  const highlights = Array.isArray(parsed.highlights)
    ? uniqueStrings(parsed.highlights.map(normalizeText).filter(Boolean)).slice(0, 5)
    : []

  if (!summary && !highlights.length && !title) return null

  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(highlights.length ? { highlights } : {}),
  }
}

export function getTopCandidateReason(candidate) {
  const normalized = normalizeTopCandidateReason(candidate?.top_candidate_reason)
  if (normalized?.summary || normalized?.highlights?.length) return normalized

  const highlights = [
    candidate?.final_score !== null && candidate?.final_score !== undefined
      ? `Final score: ${formatScore(candidate.final_score)}`
      : null,
    relationshipValue(candidate) !== 'Not available' ? `Relationship: ${relationshipValue(candidate)}` : null,
    normalizeText(candidate?.current_company) ? `Company: ${normalizeText(candidate.current_company)}` : null,
    normalizeText(candidate?.recommendation || candidate?.ai_analysis?.overall_recommendation)
      ? `Recommendation: ${normalizeText(candidate.recommendation || candidate.ai_analysis?.overall_recommendation)}`
      : null,
    normalizeText(candidate?.role) ? `Role: ${normalizeText(candidate.role)}` : null,
  ].filter(Boolean)

  return {
    summary:
      'This candidate earned a top position based on their overall score, relationship strength, role relevance, and outreach potential.',
    highlights: uniqueStrings(highlights).slice(0, 5),
  }
}

export function getReasonHeading(candidate) {
  const rank = fallback(candidate?.rank, '')
  if (rank && rank !== 'Not available' && rank !== '-') return `Why this candidate ranked #${rank}`
  return 'Why this candidate ranked highly'
}

export function getRelationshipEvidence(candidate) {
  const analysis = parseObject(candidate?.analysis)
  const aiAnalysis = parseObject(candidate?.ai_analysis)
  const profile = parseObject(candidate?.profile)

  return (
    candidate?.relationship_evidence ??
    analysis?.relationship_evidence ??
    aiAnalysis?.relationship_evidence ??
    profile?.relationship_evidence ??
    null
  )
}

export function normalizeRelationshipEvidence(value) {
  if (!value) return null

  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const evidence = {}
  ;['same_company', 'same_location', 'same_school', 'same_department'].forEach((field) => {
    if (typeof parsed[field] === 'boolean') evidence[field] = parsed[field]
  })
  ;['department_similarity', 'years_at_company'].forEach((field) => {
    if (typeof parsed[field] === 'number' && Number.isFinite(parsed[field])) evidence[field] = parsed[field]
  })

  return Object.keys(evidence).length ? evidence : null
}

export function buildRelationshipEvidenceItems(evidence, candidate) {
  if (!evidence) return []

  const company = normalizeText(candidate?.current_company || candidate?.company)
  const location = normalizeText(candidate?.location)
  const department = normalizeText(candidate?.department || candidate?.current_department)
  const items = []

  if (evidence.same_company === true) {
    const value = company || 'Yes'
    items.push({
      key: 'same-company',
      label: 'Same company',
      value,
      text: `Same company: ${value}`,
    })
  }

  if (evidence.same_location === true) {
    const value = location || 'Yes'
    items.push({
      key: 'same-location',
      label: 'Same location',
      value,
      text: `Same location: ${value}`,
    })
  }

  if (evidence.same_school === true) {
    items.push({
      key: 'same-school',
      label: 'Same school',
      value: 'Yes',
      text: 'Same school',
    })
  }

  if (evidence.same_department === true) {
    const value = department || 'Yes'
    items.push({
      key: 'same-department',
      label: 'Same department',
      value,
      text: `Same department: ${value}`,
    })
  }

  if (typeof evidence.department_similarity === 'number' && Number.isFinite(evidence.department_similarity)) {
    const value = formatSimilarity(evidence.department_similarity)
    items.push({
      key: 'department-similarity',
      label: 'Department similarity',
      value,
      text: `Department similarity: ${value}`,
    })
  }

  if (typeof evidence.years_at_company === 'number' && Number.isFinite(evidence.years_at_company) && evidence.years_at_company >= 0) {
    const value = formatYears(evidence.years_at_company)
    items.push({
      key: 'years-at-company',
      label: 'Time at company',
      value,
      text: `Time at company: ${value}`,
    })
  }

  return items.slice(0, 6)
}

export function formatSimilarity(value) {
  const normalized = value >= 0 && value <= 1 ? value * 100 : value
  const clamped = Math.min(100, Math.max(0, normalized))
  return `${Math.round(clamped)}%`
}

export function formatYears(value) {
  const rounded = Math.round(value * 10) / 10
  return rounded === 1 ? '1 year' : `${rounded} years`
}

function normalizeText(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function parseObject(value) {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function uniqueStrings(values) {
  const seen = new Set()
  return values.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
