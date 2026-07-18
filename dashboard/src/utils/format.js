export const EMPTY = 'Not available'

export function isPresent(value) {
  return value !== undefined && value !== null && value !== ''
}

export function fallback(value, label = EMPTY) {
  if (!isPresent(value)) return label
  if (typeof value === 'number' && Number.isNaN(value)) return label
  return String(value)
}

export function formatNumber(value, fallbackValue = '0') {
  const number = Number(value)
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : fallbackValue
}

export function formatScore(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number).toString() : EMPTY
}

export function formatDate(value) {
  if (!value) return EMPTY
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return EMPTY
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatShortDate(value) {
  if (!value) return EMPTY
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return EMPTY
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function truncate(value, max = 140) {
  const text = fallback(value, '')
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

export function initials(name) {
  const parts = fallback(name, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'WP'
}

export function isValidLinkedInUrl(value) {
  try {
    const url = new URL(value)
    return ['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function safeJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function getNestedValue(record, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], record)
    if (isPresent(value)) return value
  }
  return null
}

export function relationshipValue(record) {
  return getNestedValue(record, [
    'relationship_strength',
    'ai_analysis.relationship_strength.level',
    'ai_analysis.relationship_strength.score',
    'analysis.relationship_strength',
  ])
}

export function recommendationValue(record) {
  return getNestedValue(record, [
    'recommendation',
    'ai_analysis.overall_recommendation',
    'analysis.recommendation',
  ])
}

export function introductionValue(record) {
  return getNestedValue(record, [
    'personalized_introduction',
    'ai_analysis.personalized_introduction',
  ])
}

export function gradeClass(value) {
  const grade = fallback(value, '').toUpperCase()
  if (grade.startsWith('A')) return 'badge-success'
  if (grade.startsWith('B')) return 'badge-info'
  if (grade.startsWith('C')) return 'badge-warning'
  return 'badge-muted'
}

export function statusClass(value) {
  const status = fallback(value, '').toLowerCase()
  if (/complete|success|done/.test(status)) return 'badge-success'
  if (/fail|error|cancel/.test(status)) return 'badge-danger'
  if (/run|progress|pending/.test(status)) return 'badge-warning'
  return 'badge-muted'
}

export function encodeRouteKey(record) {
  if (isPresent(record?.id)) return String(record.id)

  const payload = {
    rank: record?.rank ?? null,
    linkedin_url: record?.linkedin_url ?? null,
    name: record?.name ?? null,
    current_company: record?.current_company ?? null,
    created_at: record?.created_at ?? null,
  }

  return `key.${btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`
}

export function decodeRouteKey(value) {
  if (!value?.startsWith('key.')) return null
  const base64 = value.slice(4).replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')

  try {
    return JSON.parse(decodeURIComponent(escape(atob(padded))))
  } catch {
    return null
  }
}
