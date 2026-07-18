# Warm Path Finder Engine Notes

## Pipeline

The production flow remains unchanged:

`target.json -> mutuals.json -> mutual-details.json -> classify-all.js -> Relationship-Evidence.js -> mutual-details-classified.json -> send-to-n8n.js`

## Target And Profile Shape

Scraped profiles keep the core profile fields used by the Warm Path Finder:
identity, headline, location, about, current company, position, network counts,
experience, education, skills, classifications, and relationship scoring data.

## Normalization

- `CompanyNormalizer` strips punctuation and legal suffixes such as `AB`, `Ltd`, `Pvt Ltd`, `Private Limited`, `Inc`, `LLC`, and equivalents.
- `DepartmentNormalizer` maps role text into production categories such as `backend`, `frontend`, `software`, `data`, `ai`, `ml`, `finance`, `hr`, `operations`, `sales`, `marketing`, `legal`, `support`, `customer success`, `security`, and `infrastructure`.
- `LocationNormalizer` parses city, state, and country. It can distinguish same city, same state, and same country.
- `DurationParser` supports `Nov 2024`, `November 2024`, `2024`, `Present`, `Current`, `Now`, and common dash styles.

## Relationship Evidence

`relationship_evidence` contains potential relationship signals:

- `same_company`
- `same_department`
- `same_location`
- `same_school`
- `shared_skills`
- `shared_technologies`
- `experience_overlap`
- `education_overlap`
- `current_employee`
- `years_at_company`

No relationship evidence is invented. Missing LinkedIn sections produce empty arrays, false booleans, or zero counts.

## Scoring

`Relationship-Evidence.js` calculates `relationship_strength` after all relationship fields are populated.

High-impact signals:

- Current employee at target company
- Same company, department, location, or school
- Shared skills and technologies
- Experience and education overlap

Relationship evidence is retained as compact matching signals for downstream ranking and reporting.

## AI Readiness

Classified profiles sent to n8n keep the compact profile fields and
`relationship_evidence`. Verbose warm-score explanation fields are not emitted
in `mutual-details-classified.json`.

## Debug Mode

Set `DEBUG=true` to log relationship matching, technology matching, and warm score details.

Legacy relationship comparison logging still works with `RELATIONSHIP_DEBUG=1`.

## Validation

Run:

```bash
npm test
```

This runs JavaScript syntax checks and validation tests for:

- company normalization
- department normalization
- location normalization
- duration parsing
- relationship evidence
- technology extraction
