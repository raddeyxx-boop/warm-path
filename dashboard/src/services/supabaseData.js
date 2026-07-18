import { supabase, getConfigError } from '../lib/supabase'
import {
  decodeRouteKey,
  getNestedValue,
  recommendationValue,
  relationshipValue,
  safeJson,
} from '../utils/format'
import { normalizeCandidateDisplay } from '../utils/candidateDisplay'

const PAGE_SIZE = 25
const MAX_CANDIDATE_ROWS = 1000
const WORKFLOW_RUN_COLUMNS = [
  'id',
  'status',
  'target_person',
  'target_company',
  'total_candidates',
  'created_at',
  'completed_at',
  'average_final_score',
  'top_candidates_count',
  'started_at',
  'updated_at',
  'current_step',
  'current_message',
  'progress_percent',
  'estimated_remaining_seconds',
  'profiles_found',
  'profiles_processed',
  'mutual_connections',
  'candidates_ranked',
  'ai_analyses_completed',
  'cache_hit',
].join(',')

function ensureClient() {
  const configError = getConfigError()
  if (configError) {
    throw new Error(configError)
  }
  return supabase
}

function explainError(error, table) {
  if (!error) return null
  console.error(`Supabase ${table} error`, error)

  const message = error.message || 'Unknown Supabase error'
  if (/permission|policy|rls|not authorized|jwt/i.test(message)) {
    return new Error(`Supabase denied read access to ${table}. Check read-only RLS policies.`)
  }
  if (/does not exist|schema cache|column/i.test(message)) {
    return new Error(`Supabase table or column is unavailable for ${table}: ${message}`)
  }
  return new Error(`Could not load ${table}: ${message}`)
}

async function runQuery(query, table) {
  const { data, error, count } = await query
  if (error) throw explainError(error, table)
  return { data: data || [], count: count ?? null }
}

async function countRows(table) {
  const client = ensureClient()
  const { count, error } = await client.from(table).select('*', {
    count: 'exact',
    head: true,
  })

  if (error) throw explainError(error, table)
  return count || 0
}

function hasText(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null && value !== ''
}

function hasCandidateText(value) {
  if (!hasText(value)) return false
  return normalizeMatchValue(value) !== 'not available'
}

function hasStructuredContent(value) {
  const parsed = safeJson(value) || value
  if (!parsed) return false
  if (Array.isArray(parsed)) return parsed.length > 0
  if (typeof parsed === 'object') return Object.keys(parsed).length > 0
  return hasText(parsed)
}

function hasUsefulCandidateFields(row) {
  return [
    row.profile,
    row.analysis,
    row.ai_analysis,
    row.final_score,
    row.final_grade,
    row.recommendation,
    row.relationship_strength,
    row.personalized_introduction,
    row.rank,
    row.current_company,
    row.position,
    row.location,
    row.role,
    row.seniority,
    row.decision_power,
  ].some((value) => hasStructuredContent(value) || hasText(value))
}

function isValidCandidateRow(row, { topCandidate = false } = {}) {
  if (!row?.id || !hasCandidateText(row.name) || !hasCandidateText(row.linkedin_url)) return false
  if (topCandidate && (row.rank === undefined || row.rank === null || Number(row.rank) > 3)) return false
  return hasUsefulCandidateFields(row)
}

function filterValidCandidateRows(rows, options) {
  return (rows || []).filter((row) => isValidCandidateRow(row, options))
}

function applyValidCandidateFilters(query, { topCandidate = false } = {}) {
  let filtered = query
    .not('id', 'is', null)
    .not('name', 'is', null)
    .neq('name', '')
    .neq('name', 'Not available')
    .not('linkedin_url', 'is', null)
    .neq('linkedin_url', '')
    .neq('linkedin_url', 'Not available')

  if (topCandidate) {
    filtered = filtered.not('rank', 'is', null).lte('rank', 3)
  }

  return filtered
}

function applyCandidateOrder(query, sort = 'rank') {
  if (sort === 'score-low') return query.order('final_score', { ascending: true, nullsFirst: false })
  if (sort === 'score-high') return query.order('final_score', { ascending: false, nullsFirst: false })
  if (sort === 'name') return query.order('name', { ascending: true, nullsFirst: false })
  if (sort === 'company') return query.order('current_company', { ascending: true, nullsFirst: false })
  if (sort === 'newest') return query.order('created_at', { ascending: false, nullsFirst: false })
  return query.order('rank', { ascending: true, nullsFirst: false })
}

function normalizeMatchValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isMissingColumnError(error, column) {
  const message = error?.message || ''
  return new RegExp(`${column}.*(does not exist|schema cache)|column.*${column}`, 'i').test(message)
}

async function firstRankedCandidate(matchingQuery, context) {
  const newestResult = await matchingQuery()
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (!newestResult.error) return newestResult.data?.[0] || null
  if (!isMissingColumnError(newestResult.error, 'created_at')) {
    throw explainError(newestResult.error, context)
  }

  const rankedResult = await matchingQuery()
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(1)

  if (rankedResult.error) throw explainError(rankedResult.error, context)
  return rankedResult.data?.[0] || null
}

async function findRankedCandidateByLinkedInUrl(client, linkedinUrl) {
  if (!linkedinUrl) return null

  const row = await firstRankedCandidate(
    () => applyValidCandidateFilters(client.from('ranked_candidates').select('*').eq('linkedin_url', linkedinUrl)),
    'ranked_candidates',
  )
  return isValidCandidateRow(row) ? row : null
}

async function findRankedCandidateByNameAndCompany(client, candidate) {
  const name = normalizeMatchValue(candidate?.name)
  const company = normalizeMatchValue(candidate?.current_company)
  if (!name || !company) return null

  const { data } = await runQuery(
    applyValidCandidateFilters(client.from('ranked_candidates').select('*'))
      .order('rank', { ascending: true })
      .range(0, MAX_CANDIDATE_ROWS - 1),
    'ranked_candidates',
  )

  const matches = filterValidCandidateRows(data).filter((row) => {
    return normalizeMatchValue(row.name) === name && normalizeMatchValue(row.current_company) === company
  })

  return matches.sort((a, b) => {
    const aCreated = Date.parse(a.created_at || '')
    const bCreated = Date.parse(b.created_at || '')

    if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) {
      return bCreated - aCreated
    }
    if (Number.isFinite(aCreated) !== Number.isFinite(bCreated)) {
      return Number.isFinite(aCreated) ? -1 : 1
    }

    const aRank = Number(a.rank)
    const bRank = Number(b.rank)
    if (Number.isFinite(aRank) && Number.isFinite(bRank)) return aRank - bRank
    if (Number.isFinite(aRank) !== Number.isFinite(bRank)) return Number.isFinite(aRank) ? -1 : 1
    return 0
  })[0] || null
}

async function resolveFullCandidateFromTopRow(client, topRow) {
  if (!topRow) return null

  if (topRow.linkedin_url) {
    const fullRow = await findRankedCandidateByLinkedInUrl(client, topRow.linkedin_url)
    if (fullRow) return fullRow
  }

  return findRankedCandidateByNameAndCompany(client, topRow)
}

function mergeCandidateRows(fullRow, topRow) {
  if (!fullRow) return topRow
  const merged = { ...fullRow, ...topRow }

  Object.keys(fullRow).forEach((key) => {
    const topValue = topRow?.[key]
    if (!hasMergeValue(topValue)) {
      merged[key] = fullRow[key]
    }
  })

  return merged
}

function hasMergeValue(value) {
  if (typeof value === 'object' && value !== null) return hasStructuredContent(value)
  if (typeof value === 'string' && /^[{[]/.test(value.trim())) return hasStructuredContent(value)
  return hasCandidateText(value)
}

function localCandidateFilter(rows, filters = {}, search = '') {
  const searchText = search.trim().toLowerCase()
  return rows.filter((row) => {
    const searchable = [
      row.name,
      row.current_company,
      row.position,
      row.location,
      row.role,
      row.seniority,
      row.recommendation,
      relationshipValue(row),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    if (searchText && !searchable.includes(searchText)) return false

    return Object.entries(filters).every(([key, value]) => {
      if (!value) return true
      if (key === 'relationship_strength') {
        return String(relationshipValue(row) || '') === value
      }
      return String(row[key] || '') === value
    })
  })
}

export async function getDashboardStats() {
  const [runs, topRows, rankedRows, recentRuns] = await Promise.all([
    countRows('workflow_runs').catch(() => 0),
    getTopCandidates({ limit: 3 }).catch(() => []),
    getRankedCandidates({ page: 1, pageSize: MAX_CANDIDATE_ROWS }).catch(() => ({ data: [], count: 0 })),
    getWorkflowRuns({ page: 1, pageSize: 5 }).catch(() => ({ data: [] })),
  ])

  const candidates = rankedRows.data || []
  const scores = candidates.map((row) => Number(row.final_score)).filter(Number.isFinite)
  const averageScore = scores.length
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : null

  const strongRelationships = candidates.filter((row) => {
    const value = relationshipValue(row)
    return /strong|high/i.test(String(value || '')) || Number(value) >= 80
  }).length

  const highRecommendations = candidates.filter((row) => {
    return String(recommendationValue(row) || '').trim() === 'Strong'
  }).length

  return {
    totals: {
      runs,
      ranked: rankedRows.count || 0,
      top: topRows.length,
      averageScore,
      strongRelationships,
      highRecommendations,
    },
    topRows,
    recentRuns: recentRuns.data || [],
  }
}

export async function getTopCandidates({ limit = 50 } = {}) {
  const client = ensureClient()
  const cappedLimit = Math.min(limit, 3)
  const { data } = await runQuery(
    applyValidCandidateFilters(client.from('top_candidates').select('*'), { topCandidate: true })
      .order('rank', { ascending: true })
      .limit(cappedLimit),
    'top_candidates',
  )
  const validRows = filterValidCandidateRows(data, { topCandidate: true }).slice(0, cappedLimit)
  const hydratedRows = await Promise.all(
    validRows.map(async (row) => {
      const fullRow = await resolveFullCandidateFromTopRow(client, row).catch(() => null)
      return normalizeCandidateDisplay(mergeCandidateRows(fullRow, row))
    }),
  )
  return hydratedRows
}

export async function getTopCandidatesForRun(runId) {
  const client = ensureClient()
  const { data } = await runQuery(
    applyValidCandidateFilters(
      client
        .from('top_candidates')
        .select('*')
        .eq('workflow_run_id', runId),
      { topCandidate: true },
    )
      .order('rank', { ascending: true })
      .limit(3),
    'top_candidates',
  )
  return filterValidCandidateRows(data, { topCandidate: true }).slice(0, 3).map(normalizeCandidateDisplay)
}

export async function getRankedCandidates({
  page = 1,
  pageSize = PAGE_SIZE,
  search = '',
  filters = {},
  sort = 'rank',
} = {}) {
  const client = ensureClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query = applyValidCandidateFilters(client.from('ranked_candidates').select('*'))
  query = applyCandidateOrder(query, sort).range(0, MAX_CANDIDATE_ROWS - 1)
  const { data } = await runQuery(query, 'ranked_candidates')
  const validRows = filterValidCandidateRows(data)
  const filtered = localCandidateFilter(validRows, filters, search)

  return {
    data: filtered.slice(from, to + 1).map(normalizeCandidateDisplay),
    count: filtered.length,
  }
}

export async function getRankedCandidateById(id) {
  const client = ensureClient()
  const decoded = decodeRouteKey(id)

  if (!decoded) {
    const rankedResult = await applyValidCandidateFilters(client.from('ranked_candidates').select('*').eq('id', id)).maybeSingle()
    if (rankedResult.error) throw explainError(rankedResult.error, 'ranked_candidates')
    if (isValidCandidateRow(rankedResult.data)) return normalizeCandidateDisplay(rankedResult.data)

    const topResult = await applyValidCandidateFilters(client.from('top_candidates').select('*').eq('id', id), {
      topCandidate: true,
    }).maybeSingle()
    if (topResult.error) throw explainError(topResult.error, 'top_candidates')
    if (!topResult.data) {
      return null
    }

    const fullRow = await resolveFullCandidateFromTopRow(client, topResult.data)
    return normalizeCandidateDisplay(fullRow)
  }

  const fullRow =
    (await findRankedCandidateByLinkedInUrl(client, decoded.linkedin_url)) ||
    (await findRankedCandidateByNameAndCompany(client, decoded))

  return normalizeCandidateDisplay(fullRow)
}

export async function getWorkflowRuns({ page = 1, pageSize = PAGE_SIZE, search = '', status = '', sort = 'newest' } = {}) {
  const client = ensureClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query = client.from('workflow_runs').select(WORKFLOW_RUN_COLUMNS, { count: 'exact' })

  if (status) query = query.eq('status', status)

  query = query.order(sort === 'oldest' ? 'created_at' : 'created_at', {
    ascending: sort === 'oldest',
    nullsFirst: false,
  })

  if (!search) {
    return runQuery(query.range(from, to), 'workflow_runs')
  }

  const { data } = await runQuery(query.range(0, 999), 'workflow_runs')
  const needle = search.toLowerCase()
  const filtered = data.filter((row) => JSON.stringify(row).toLowerCase().includes(needle))
  return { data: filtered.slice(from, to + 1), count: filtered.length }
}

export async function getWorkflowRunById(id) {
  const client = ensureClient()
  const { data, error } = await client.from('workflow_runs').select(WORKFLOW_RUN_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw explainError(error, 'workflow_runs')
  return data
}

export async function getCandidatesForRun(runId) {
  const client = ensureClient()
  const fields = ['workflow_run_id', 'run_id']

  for (const field of fields) {
    const { data, error } = await client
      .from('ranked_candidates')
      .select('*')
      .eq(field, runId)
      .not('id', 'is', null)
      .not('name', 'is', null)
      .neq('name', '')
      .neq('name', 'Not available')
      .not('linkedin_url', 'is', null)
      .neq('linkedin_url', '')
      .neq('linkedin_url', 'Not available')
      .order('rank', { ascending: true })

    const validRows = filterValidCandidateRows(data)
    if (!error && validRows.length) return { data: validRows.map(normalizeCandidateDisplay), field }
  }

  return { data: [], field: null }
}

export function getRunTargetSummary(run) {
  if (hasText(run?.target_person)) return String(run.target_person).trim()
  if (hasText(run?.target_company)) return String(run.target_company).trim()

  const target = safeJson(run?.target) || run?.target || {}
  if (typeof target === 'string') return target
  return [target.name, target.company || target.current_company, target.position || target.headline]
    .filter(Boolean)
    .join(' | ')
}

export function getCandidateRelationship(row) {
  return relationshipValue(row)
}

export function getCandidateIntroduction(row) {
  return getNestedValue(row, ['personalized_introduction', 'ai_analysis.personalized_introduction'])
}

export function subscribeWorkflowRuns(onChange) {
  const client = ensureClient()
  const channel = client
    .channel('workflow-runs-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_runs' }, onChange)
    .subscribe()
  return () => client.removeChannel(channel)
}
