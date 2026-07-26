const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const root = join(__dirname, '..', 'src')
const card = readFileSync(join(root, 'components', 'CandidateCard.jsx'), 'utf8')
const reason = readFileSync(join(root, 'utils', 'topCandidateReason.js'), 'utf8')
const service = readFileSync(join(root, 'services', 'supabaseData.js'), 'utf8')

test('flip card preserves the AI explanation and adds a separate factual evidence section', () => {
  assert.match(card, /reason\.summary/)
  assert.match(card, /reason\.highlights/)
  assert.match(card, /Relationship evidence/)
  assert.match(card, /relationshipEvidenceItems\.map/)
  assert.ok(card.indexOf('reason.summary') < card.indexOf('Relationship evidence'))
})

test('only explicit affirmative relationship evidence becomes a visible signal', () => {
  for (const field of ['same_company', 'same_location', 'same_school', 'same_department', 'current_employee']) {
    assert.match(reason, new RegExp(`evidence\\.${field} === true`))
  }
  assert.match(reason, /evidence\.department_similarity > 0/)
  assert.match(reason, /evidence\.years_at_company > 0/)
  assert.doesNotMatch(reason, /evidence\.years_at_company >= 0/)
})

test('historical run top candidates hydrate factual evidence from ranked candidates without reordering', () => {
  const functionSource = service.match(/export async function getTopCandidatesForRun[\s\S]*?\n}\n\nexport async function getRankedCandidates/)?.[0] || ''
  assert.match(functionSource, /order\('rank', \{ ascending: true \}\)/)
  assert.match(functionSource, /resolveFullCandidateFromTopRow\(client, row, owner\)/)
  assert.match(functionSource, /mergeCandidateRows\(fullRow, row\)/)
  assert.match(functionSource, /Promise\.all/)
  assert.doesNotMatch(functionSource, /\.sort\(/)
})

test('the frontend accepts evidence from the persisted candidate locations without inference from text', () => {
  assert.match(reason, /candidate\?\.relationship_evidence/)
  assert.match(reason, /analysis\?\.relationship_evidence/)
  assert.match(reason, /aiAnalysis\?\.relationship_evidence/)
  assert.match(reason, /profile\?\.relationship_evidence/)
  assert.doesNotMatch(reason, /headline.*same_company|about.*same_company/i)
})

test('persisted candidate data keeps the AI explanation and emits only factual evidence', async () => {
  const moduleUrl = pathToFileURL(join(root, 'utils', 'topCandidateReason.js')).href
  const { buildRelationshipEvidenceItems, getRelationshipEvidence, getTopCandidateReason, normalizeRelationshipEvidence } = await import(moduleUrl)
  const persistedCandidate = {
    name: 'Sindhu M', current_company: 'Indpro AB', location: 'Bengaluru',
    top_candidate_reason: {
      summary: 'Sindhu M ranked among the top candidates because of verified relationship and ranking factors.',
      highlights: ['Excellent company alignment', 'High professional credibility'],
    },
    relationship_evidence: {
      same_company: true, same_location: false, same_school: false, same_department: false,
      department_similarity: 0, years_at_company: 4.8, current_employee: true,
    },
  }
  const explanation = getTopCandidateReason(persistedCandidate)
  const evidence = normalizeRelationshipEvidence(getRelationshipEvidence(persistedCandidate))
  const items = buildRelationshipEvidenceItems(evidence, persistedCandidate)

  assert.equal(explanation.summary, persistedCandidate.top_candidate_reason.summary)
  assert.deepEqual(explanation.highlights, persistedCandidate.top_candidate_reason.highlights)
  assert.deepEqual(items.map((item) => item.key), ['same-company', 'current-employee', 'years-at-company'])
  assert.equal(items.find((item) => item.key === 'years-at-company').value, '4.8 years')
  assert.ok(!items.some((item) => item.key === 'same-location' || item.key === 'department-similarity'))

  assert.deepEqual(buildRelationshipEvidenceItems(normalizeRelationshipEvidence(null), persistedCandidate), [])
  const defaults = normalizeRelationshipEvidence({
    same_company: false, same_location: false, same_school: false, same_department: false,
    department_similarity: 0, years_at_company: 0, current_employee: false,
  })
  assert.deepEqual(buildRelationshipEvidenceItems(defaults, persistedCandidate), [])
})
