import { supabase } from '../lib/supabase'
import { requireSupabaseSession } from './authSession'
import { normalizeLinkedInProfileUrl } from '../../../types/target-search-request.ts'

export const ACTIVE_SEARCH_MESSAGE = 'You already have a search in progress. Wait for it to finish before starting another.'

const REQUIRED_FIELDS = ['targetName', 'currentCompany', 'linkedinName', 'location']
const LIST_FIELDS = ['keywords', 'companyFilter', 'schoolFilter']

export class TargetSearchError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'TargetSearchError'
    this.code = code
  }
}

function collapseWhitespace(value) {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeCommaList(value) {
  const seen = new Set()
  const values = []

  for (const item of String(value || '').split(',')) {
    const normalized = collapseWhitespace(item)
    const comparisonKey = normalized.toLowerCase()
    if (!normalized || seen.has(comparisonKey)) continue
    seen.add(comparisonKey)
    values.push(normalized)
  }

  return values
}

export function normalizeTargetSearchForm(formData) {
  let linkedinUrl
  try {
    linkedinUrl = normalizeLinkedInProfileUrl(formData?.linkedinName) || ''
  } catch (error) {
    throw new TargetSearchError('validation', 'Enter a valid LinkedIn profile URL.', error)
  }

  const normalized = {
    targetName: String(formData?.targetName || '').trim(),
    currentCompany: String(formData?.currentCompany || '').trim(),
    linkedinName: linkedinUrl,
    location: String(formData?.location || '').trim(),
  }

  for (const field of LIST_FIELDS) {
    normalized[field] = normalizeCommaList(formData?.[field]).join(', ')
  }

  if (REQUIRED_FIELDS.some((field) => !normalized[field])) {
    throw new TargetSearchError('validation', 'Complete all required target fields before starting a search.')
  }

  return normalized
}

function keyText(value) {
  return collapseWhitespace(value).toLowerCase()
}

function sortedListKey(value) {
  return normalizeCommaList(value)
    .map((item) => keyText(item))
    .sort()
    .join(',')
}

export async function createNormalizedSearchKey(normalizedForm) {
  const source = [
    keyText(normalizedForm.targetName),
    keyText(normalizedForm.currentCompany),
    keyText(normalizedForm.linkedinName),
    keyText(normalizedForm.location),
    sortedListKey(normalizedForm.keywords),
    sortedListKey(normalizedForm.companyFilter),
    sortedListKey(normalizedForm.schoolFilter),
  ].join('|')

  const bytes = new TextEncoder().encode(source)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function friendlyError(error) {
  if (error instanceof TargetSearchError) return error
  if (error?.code === '23505' || error?.constraint === 'search_requests_one_active_per_owner_idx') {
    return new TargetSearchError('active_search', ACTIVE_SEARCH_MESSAGE, error)
  }
  if (error?.code === '42501') {
    return new TargetSearchError('permission', 'Supabase denied permission to initialize this search.', error)
  }
  if (error?.code === '28000' || /session|authentication|jwt/i.test(error?.message || '')) {
    return new TargetSearchError('authentication', 'Your session has expired. Please sign in again.', error)
  }
  if (/fetch|network/i.test(error?.message || '')) {
    return new TargetSearchError('network', 'Unable to reach Supabase. Check your connection and try again.', error)
  }
  return new TargetSearchError('initialization', 'Unable to initialize the search. Please try again.', error)
}

export async function initializeTargetSearch(formData) {
  try {
    const session = await requireSupabaseSession()
    const normalizedForm = normalizeTargetSearchForm(formData)
    const normalizedSearchKey = await createNormalizedSearchKey(normalizedForm)

    const { error: recoveryError } = await supabase.rpc('recover_abandoned_target_searches')
    if (recoveryError) throw recoveryError

    const { data: activeSearch, error: activeError } = await supabase
      .from('search_requests')
      .select('workflow_run_id')
      .eq('owner_user_id', session.user.id)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activeError) throw activeError
    if (activeSearch) {
      return {
        ok: false,
        code: 'active_search',
        message: ACTIVE_SEARCH_MESSAGE,
        workflowRunId: activeSearch.workflow_run_id || null,
      }
    }

    const { data, error } = await supabase.rpc('initialize_target_search', {
      p_target_name: normalizedForm.targetName,
      p_current_company: normalizedForm.currentCompany,
      p_linkedin_name: normalizedForm.linkedinName,
      p_location: normalizedForm.location,
      p_keywords: normalizedForm.keywords,
      p_company_filter: normalizedForm.companyFilter,
      p_school_filter: normalizedForm.schoolFilter,
      p_normalized_search_key: normalizedSearchKey,
    })

    if (error) throw error
    const result = data?.[0]

    if (result?.result_code === 'active_search') {
      return {
        ok: false,
        code: 'active_search',
        message: ACTIVE_SEARCH_MESSAGE,
        workflowRunId: result.workflow_run_id || null,
      }
    }

    if (result?.result_code !== 'initialized' || !result.workflow_run_id || !result.search_request_id) {
      throw new TargetSearchError('initialization', 'Supabase returned an incomplete initialization result.')
    }

    return {
      ok: true,
      code: 'initialized',
      workflowRunId: result.workflow_run_id,
      searchRequestId: result.search_request_id,
      normalizedSearchKey,
      normalizedForm,
    }
  } catch (error) {
    throw friendlyError(error)
  }
}

function getSearchStartUrl() {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${baseUrl}/api/searches/start`
}

export async function prepareInitializedTargetSearch(workflowRunId, searchRequestId) {
  try {
    const session = await requireSupabaseSession()
    const response = await fetch(getSearchStartUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        workflow_run_id: workflowRunId,
        search_request_id: searchRequestId,
      }),
    })
    const result = await response.json().catch(() => null)

    if (!response.ok) {
      throw new TargetSearchError(
        result?.code || 'api_error',
        result?.message || 'Unable to prepare the search. Please try again.',
      )
    }

    return result
  } catch (error) {
    if (error instanceof TargetSearchError) throw error
    throw friendlyError(error)
  }
}
