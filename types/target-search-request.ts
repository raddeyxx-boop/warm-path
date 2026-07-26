export type TargetSearchTarget = {
  name: string
  current_company: string | null
  linkedin_url: string | null
  location: string | null
  keywords: string | null
  company_filter: string | null
  school_filter: string | null
}

export type TargetSearchRequest = {
  workflow_run_id: string
  search_request_id: string
  owner_user_id?: string
  normalized_search_key?: string
  target: TargetSearchTarget
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function nullableText(value: unknown): string | null {
  return cleanText(value) || null
}

export function normalizeLinkedInProfileUrl(value: unknown): string | null {
  const input = cleanText(value)
  if (!input) return null
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`

  try {
    const url = new URL(withProtocol)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const profileMatch = url.pathname.match(/^\/in\/([^/]+)\/?$/i)
    if (hostname !== 'linkedin.com' || !profileMatch?.[1]) throw new Error('invalid profile path')
    return `https://www.linkedin.com/in/${profileMatch[1]}`
  } catch (error) {
    throw new Error('LinkedIn profile URL is invalid.', { cause: error })
  }
}

export function validateTargetSearchRequest(rawInput: unknown): Readonly<TargetSearchRequest> {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Target input is missing from the workflow payload.')
  }

  const input = rawInput as Record<string, unknown>
  if (!UUID_PATTERN.test(cleanText(input.workflow_run_id))) {
    throw new Error('Automation payload is missing workflow_run_id.')
  }
  if (!UUID_PATTERN.test(cleanText(input.search_request_id))) {
    throw new Error('Automation payload is missing search_request_id.')
  }
  if (input.owner_user_id != null && !UUID_PATTERN.test(cleanText(input.owner_user_id))) {
    throw new Error('Automation payload owner_user_id is invalid.')
  }
  if (!input.target || typeof input.target !== 'object' || Array.isArray(input.target)) {
    throw new Error('Target input is missing from the workflow payload.')
  }

  const rawTarget = input.target as Record<string, unknown>
  const target = Object.freeze({
    name: cleanText(rawTarget.name),
    current_company: nullableText(rawTarget.current_company),
    linkedin_url: normalizeLinkedInProfileUrl(rawTarget.linkedin_url),
    location: nullableText(rawTarget.location),
    keywords: nullableText(rawTarget.keywords),
    company_filter: nullableText(rawTarget.company_filter),
    school_filter: nullableText(rawTarget.school_filter),
  })

  if (!target.name && !target.linkedin_url) {
    throw new Error('Playwright target input is missing. A target name or LinkedIn URL is required.')
  }

  return Object.freeze({
    workflow_run_id: cleanText(input.workflow_run_id),
    search_request_id: cleanText(input.search_request_id),
    ...(input.owner_user_id ? { owner_user_id: cleanText(input.owner_user_id) } : {}),
    ...(input.normalized_search_key ? { normalized_search_key: cleanText(input.normalized_search_key) } : {}),
    target,
  })
}

function identityText(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ')
}

export function assertTargetProfileMatch(
  requestedTarget: Pick<TargetSearchTarget, 'name' | 'linkedin_url'>,
  extractedProfile: Record<string, unknown>,
  loadedUrl?: string,
): void {
  const requestedUrl = normalizeLinkedInProfileUrl(requestedTarget.linkedin_url)
  const extractedUrl = normalizeLinkedInProfileUrl(extractedProfile.linkedin_url || loadedUrl)

  if (requestedUrl) {
    if (extractedUrl !== requestedUrl) {
      throw new Error('Playwright loaded a profile that does not match the requested target.')
    }
    return
  }

  const requestedName = identityText(requestedTarget.name)
  const extractedName = identityText(extractedProfile.name)
  const requestedTokens = requestedName.split(' ').filter(Boolean)
  const extractedTokens = new Set(extractedName.split(' ').filter(Boolean))
  const compatibleName = Boolean(
    requestedName && extractedName &&
    (requestedName === extractedName || requestedTokens.every((token) => extractedTokens.has(token)))
  )

  if (!compatibleName) {
    throw new Error('Playwright loaded a profile that does not match the requested target.')
  }
}
