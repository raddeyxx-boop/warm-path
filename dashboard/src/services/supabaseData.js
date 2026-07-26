import { supabase, getConfigError } from '../lib/supabase'
import {
  decodeRouteKey,
  getNestedValue,
  relationshipValue,
  safeJson,
} from '../utils/format'
import { normalizeCandidateDisplay } from '../utils/candidateDisplay'
import { calculateDashboardMetrics } from '../utils/dashboardMetrics'

const PAGE_SIZE = 25
const MAX_CANDIDATE_ROWS = 1000
const DASHBOARD_CANDIDATE_BATCH_SIZE = 1000
const WORKFLOW_RUN_COLUMNS = [
  'id',
  'status',
  'target_person',
  'target_company',
  'total_candidates',
  'created_at',
  'completed_at',
  'failed_at',
  'finished_at',
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
  'n8n_dispatch_status',
  'n8n_dispatch_error',
  'n8n_execution_id',
].join(',')

function ensureClient() {
  const configError = getConfigError()
  if (configError) {
    throw new Error(configError)
  }
  return supabase
}

async function authenticatedOwnerId(client = ensureClient()) {
  const { data, error } = await client.auth.getUser()
  const ownerUserId = data?.user?.id
  if (error || !ownerUserId) throw new Error('An authenticated user is required to load dashboard data.')
  return ownerUserId
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

async function countRows(table, ownerUserId) {
  const client = ensureClient()
  const owner = ownerUserId || await authenticatedOwnerId(client)
  const { count, error } = await client.from(table).select('*', {
    count: 'exact',
    head: true,
  }).eq('owner_user_id', owner)

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

async function getAllRankedCandidatesForDashboard(ownerUserId, workflowRunId = null) {
  const client = ensureClient()
  const owner = ownerUserId || await authenticatedOwnerId(client)
  const rows = []
  let from = 0

  while (true) {
    let rankedQuery = client.from('ranked_candidates').select('*').eq('owner_user_id', owner)
    if (workflowRunId) rankedQuery = rankedQuery.eq('workflow_run_id', workflowRunId)
    const { data } = await runQuery(
      applyValidCandidateFilters(rankedQuery)
        .order('id', { ascending: true })
        .range(from, from + DASHBOARD_CANDIDATE_BATCH_SIZE - 1),
      'ranked_candidates',
    )

    rows.push(...data)
    if (data.length < DASHBOARD_CANDIDATE_BATCH_SIZE) break
    from += DASHBOARD_CANDIDATE_BATCH_SIZE
  }

  return filterValidCandidateRows(rows).map(normalizeCandidateDisplay)
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

async function findRankedCandidateByLinkedInUrl(client, linkedinUrl, ownerUserId, workflowRunId = null) {
  if (!linkedinUrl) return null

  const row = await firstRankedCandidate(
    () => {
      let query = client.from('ranked_candidates').select('*').eq('owner_user_id', ownerUserId)
      if (workflowRunId) query = query.eq('workflow_run_id', workflowRunId)
      return applyValidCandidateFilters(query.eq('linkedin_url', linkedinUrl))
    },
    'ranked_candidates',
  )
  return isValidCandidateRow(row) ? row : null
}

async function findRankedCandidateByNameAndCompany(client, candidate, ownerUserId, workflowRunId = null) {
  const name = normalizeMatchValue(candidate?.name)
  const company = normalizeMatchValue(candidate?.current_company)
  if (!name || !company) return null

  let rankedQuery = client.from('ranked_candidates').select('*').eq('owner_user_id', ownerUserId)
  if (workflowRunId) rankedQuery = rankedQuery.eq('workflow_run_id', workflowRunId)
  const { data } = await runQuery(
    applyValidCandidateFilters(rankedQuery)
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

async function resolveFullCandidateFromTopRow(client, topRow, ownerUserId) {
  if (!topRow) return null

  if (topRow.linkedin_url) {
    const fullRow = await findRankedCandidateByLinkedInUrl(client, topRow.linkedin_url, ownerUserId, topRow.workflow_run_id)
    if (fullRow) return fullRow
  }

  return findRankedCandidateByNameAndCompany(client, topRow, ownerUserId, topRow.workflow_run_id)
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
  const ownerUserId = await authenticatedOwnerId()
  let recentRuns = { data: [] }
  let recentRunsError = null
  try {
    recentRuns = await getWorkflowRuns({ page: 1, pageSize: 5, ownerUserId })
  } catch (error) {
    recentRunsError = error
  }
  const activeRun = (recentRuns.data || []).find(run => run.status === 'completed') || recentRuns.data?.[0] || null
  const workflowRunId = activeRun?.id || null
  const unavailableCandidateQuery = recentRunsError
    ? Promise.reject(recentRunsError)
    : Promise.resolve([])
  const [runsResult, topRowsResult, candidatesResult] = await Promise.allSettled([
    countRows('workflow_runs', ownerUserId),
    workflowRunId ? getTopCandidates({ limit: 3, ownerUserId, workflowRunId }) : unavailableCandidateQuery,
    workflowRunId ? getAllRankedCandidatesForDashboard(ownerUserId, workflowRunId) : unavailableCandidateQuery,
  ])

  const runs = runsResult.status === 'fulfilled' ? runsResult.value : null
  const topRows = topRowsResult.status === 'fulfilled' ? topRowsResult.value : null
  const candidates = candidatesResult.status === 'fulfilled' ? candidatesResult.value : null
  const metricErrors = {
    runs: runsResult.status === 'rejected' ? runsResult.reason?.message || 'Workflow metric unavailable' : '',
    top: topRowsResult.status === 'rejected' ? topRowsResult.reason?.message || 'Top-candidate metric unavailable' : '',
    candidates: candidatesResult.status === 'rejected' ? candidatesResult.reason?.message || 'Candidate metrics unavailable' : '',
  }
  const totals = calculateDashboardMetrics({
    workflowRunId,
    workflowRuns: runs,
    rankedCandidates: candidates,
    topCandidates: topRows,
  })
  return {
    totals,
    metricErrors,
    topRows: topRows || [],
    candidateWorkflowRunId: workflowRunId,
    recentRuns: recentRuns.data || [],
  }
}

export async function getTopCandidates({ limit = 50, ownerUserId = null, workflowRunId = null } = {}) {
  const client = ensureClient()
  const owner = ownerUserId || await authenticatedOwnerId(client)
  let activeWorkflowRunId = workflowRunId
  if (!activeWorkflowRunId) {
    const { data, error } = await client.from('workflow_runs').select('id').eq('owner_user_id', owner)
      .eq('status', 'completed').order('completed_at', { ascending: false, nullsFirst: false }).limit(1)
    if (error) throw explainError(error, 'workflow_runs')
    activeWorkflowRunId = data?.[0]?.id || null
  }
  if (!activeWorkflowRunId) return []
  const cappedLimit = Math.min(limit, 3)
  const { data } = await runQuery(
    applyValidCandidateFilters(client.from('top_candidates').select('*').eq('owner_user_id', owner)
      .eq('workflow_run_id', activeWorkflowRunId), { topCandidate: true })
      .order('rank', { ascending: true })
      .limit(cappedLimit),
    'top_candidates',
  )
  const validRows = filterValidCandidateRows(data, { topCandidate: true }).slice(0, cappedLimit)
  const hydratedRows = await Promise.all(
    validRows.map(async (row) => {
      const fullRow = await resolveFullCandidateFromTopRow(client, row, owner).catch(() => null)
      return normalizeCandidateDisplay(mergeCandidateRows(fullRow, row))
    }),
  )
  return hydratedRows
}

export async function getTopCandidatesForRun(runId) {
  const client = ensureClient()
  const owner = await authenticatedOwnerId(client)
  const { data } = await runQuery(
    applyValidCandidateFilters(
      client
        .from('top_candidates')
        .select('*')
        .eq('owner_user_id', owner)
        .eq('workflow_run_id', runId),
      { topCandidate: true },
    )
      .order('rank', { ascending: true })
      .limit(3),
    'top_candidates',
  )
  const validRows = filterValidCandidateRows(data, { topCandidate: true }).slice(0, 3)
  const hydratedRows = await Promise.all(
    validRows.map(async (row) => {
      const fullRow = await resolveFullCandidateFromTopRow(client, row, owner).catch(() => null)
      return normalizeCandidateDisplay(mergeCandidateRows(fullRow, row))
    }),
  )
  return hydratedRows
}

export async function getRankedCandidates({
  page = 1,
  pageSize = PAGE_SIZE,
  search = '',
  filters = {},
  sort = 'rank',
} = {}) {
  const client = ensureClient()
  const owner = await authenticatedOwnerId(client)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query = applyValidCandidateFilters(client.from('ranked_candidates').select('*').eq('owner_user_id', owner))
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
  const owner = await authenticatedOwnerId(client)
  const decoded = decodeRouteKey(id)

  if (!decoded) {
    const rankedResult = await applyValidCandidateFilters(client.from('ranked_candidates').select('*')
      .eq('owner_user_id', owner).eq('id', id)).maybeSingle()
    if (rankedResult.error) throw explainError(rankedResult.error, 'ranked_candidates')
    if (isValidCandidateRow(rankedResult.data)) return normalizeCandidateDisplay(rankedResult.data)

    const topResult = await applyValidCandidateFilters(client.from('top_candidates').select('*')
      .eq('owner_user_id', owner).eq('id', id), {
      topCandidate: true,
    }).maybeSingle()
    if (topResult.error) throw explainError(topResult.error, 'top_candidates')
    if (!topResult.data) {
      return null
    }

    const fullRow = await resolveFullCandidateFromTopRow(client, topResult.data, owner)
    return normalizeCandidateDisplay(fullRow)
  }

  const fullRow =
    (await findRankedCandidateByLinkedInUrl(client, decoded.linkedin_url, owner)) ||
    (await findRankedCandidateByNameAndCompany(client, decoded, owner))

  return normalizeCandidateDisplay(fullRow)
}

export async function getWorkflowRuns({ page = 1, pageSize = PAGE_SIZE, search = '', status = '', sort = 'newest', ownerUserId = null } = {}) {
  const client = ensureClient()
  const owner = ownerUserId || await authenticatedOwnerId(client)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query = client.from('workflow_runs').select(WORKFLOW_RUN_COLUMNS, { count: 'exact' })
    .eq('owner_user_id', owner)

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
  const owner = await authenticatedOwnerId(client)
  const { data, error } = await client.from('workflow_runs').select(WORKFLOW_RUN_COLUMNS)
    .eq('owner_user_id', owner).eq('id', id).maybeSingle()
  if (error) throw explainError(error, 'workflow_runs')
  return data
}

export async function getCandidatesForRun(runId) {
  const client = ensureClient()
  const owner = await authenticatedOwnerId(client)
  const fields = ['workflow_run_id', 'run_id']

  for (const field of fields) {
    const { data, error } = await client
      .from('ranked_candidates')
      .select('*')
      .eq('owner_user_id', owner)
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

export function subscribeWorkflowRuns(onChange, { workflowRunId = null } = {}) {
  const client = ensureClient()
  let channel = null
  let cancelled = false
  void client.auth.getUser().then(({ data }) => {
    const ownerId = data?.user?.id
    if (!ownerId || cancelled) return
    const filter = workflowRunId ? `id=eq.${workflowRunId}` : `owner_user_id=eq.${ownerId}`
    channel = client.channel(`workflow-runs-live-${ownerId}-${workflowRunId || 'all'}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'workflow_runs', filter,
      }, (event) => {
        if (event.new?.owner_user_id && event.new.owner_user_id !== ownerId) return
        onChange(event)
      })
      .subscribe()
  })
  return () => {
    cancelled = true
    if (channel) void client.removeChannel(channel)
  }
}
