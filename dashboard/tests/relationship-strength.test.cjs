const test = require('node:test')
const assert = require('node:assert/strict')

async function metric() {
  return import('../src/utils/relationshipStrength.js')
}

const candidate = (score) => ({ ai_analysis: { relationship_strength: { score } } })

test('reads the real nested relationship-strength score', async () => {
  const { getRelationshipStrengthScore } = await metric()
  assert.equal(getRelationshipStrengthScore(candidate(82)), 82)
})

test('reads supported top-level and structured compatibility scores', async () => {
  const { getRelationshipStrengthScore } = await metric()
  assert.equal(getRelationshipStrengthScore({ relationship_strength_score: 84 }), 84)
  assert.equal(getRelationshipStrengthScore({ relationship_strength: { score: 81 } }), 81)
})

test('normalizes string and zero-to-one scores', async () => {
  const { getRelationshipStrengthScore } = await metric()
  assert.equal(getRelationshipStrengthScore(candidate('82')), 82)
  assert.equal(getRelationshipStrengthScore(candidate(0.8)), 80)
})

test('rejects missing and malformed scores', async () => {
  const { getRelationshipStrengthScore } = await metric()
  assert.equal(getRelationshipStrengthScore({}), null)
  assert.equal(getRelationshipStrengthScore(candidate('not-a-score')), null)
})

test('accepts a score exactly at the threshold', async () => {
  const { countStrongRelationships } = await metric()
  assert.equal(countStrongRelationships([candidate(80)]), 1)
})

test('counts multiple candidates and preserves a real zero', async () => {
  const { countStrongRelationships } = await metric()
  assert.equal(countStrongRelationships([candidate(90), candidate('85'), candidate(79), {}, candidate('bad')]), 2)
  assert.equal(countStrongRelationships([candidate(65), candidate(10), {}]), 0)
})

test('does not substitute unrelated final scores', async () => {
  const { getRelationshipStrengthScore } = await metric()
  assert.equal(getRelationshipStrengthScore({ final_score: 99 }), null)
})
