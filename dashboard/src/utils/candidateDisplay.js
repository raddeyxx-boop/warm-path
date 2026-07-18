import { safeJson } from './format'

const SCHOOL_AS_SKILL_PATTERNS = [
  /\bcollege\b/i,
  /\buniversity\b/i,
  /\bschool\b/i,
  /\binstitute\b/i,
  /\bacademy\b/i,
  /\bramaiah\b/i,
]

const ROLE_OVERRIDES = [
  {
    role: 'HR',
    pattern: /\b(hr|human resources|talent acquisition|recruiter|people operations|hr executive|hr manager)\b/i,
  },
  {
    role: 'Supply Chain',
    pattern: /\b(supply chain|logistics|warehouse|inventory)\b/i,
  },
  {
    role: 'Business Development',
    pattern: /\b(business development|business developer|bde|bdm)\b/i,
  },
]

export function displayRole(candidate) {
  const currentRole = cleanText(candidate?.role)
  const titleText = [
    candidate?.position,
    candidate?.headline,
    ...(Array.isArray(candidate?.profile?.experience)
      ? candidate.profile.experience.map((item) => item?.title)
      : []),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(' ')

  for (const override of ROLE_OVERRIDES) {
    if (override.pattern.test(titleText)) return override.role
  }

  return currentRole
}

export function normalizeCandidateDisplay(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate

  const normalized = { ...candidate }
  const role = displayRole(candidate)
  if (role) normalized.role = role

  const profile = safeJson(candidate.profile) || candidate.profile
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    normalized.profile = {
      ...profile,
      skills: sanitizeSkills(profile.skills),
    }
  }

  return normalized
}

export function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return skills
  return skills
    .map(cleanText)
    .filter(Boolean)
    .filter((skill) => !SCHOOL_AS_SKILL_PATTERNS.some((pattern) => pattern.test(skill)))
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
