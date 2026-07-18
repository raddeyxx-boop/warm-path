import { useState } from 'react'
import { fallback, safeJson } from '../utils/format'

function JsonValue({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="muted">Not available</span>
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">None</span>
    return (
      <div className="json-list">
        {value.map((item, index) => (
          <div className="json-list-item" key={index}>
            <JsonValue value={item} />
          </div>
        ))}
      </div>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return <span className="muted">None</span>
    return (
      <dl className="json-tree">
        {entries.map(([key, nested]) => {
          const hasNestedValue = nested && typeof nested === 'object'
          return (
            <div className={`json-row ${hasNestedValue ? 'json-row-has-children' : ''}`} key={key}>
              <dt>{key.replace(/_/g, ' ')}</dt>
              <dd>
                <JsonValue value={nested} />
              </dd>
            </div>
          )
        })}
      </dl>
    )
  }

  return <span>{fallback(value)}</span>
}

export function JsonSection({ title, value }) {
  const [rawOpen, setRawOpen] = useState(false)
  const parsed = safeJson(value) || value

  return (
    <section className="card detail-section">
      <div className="section-heading">
        <h2>{title}</h2>
        <button type="button" className="button button-ghost" onClick={() => setRawOpen((open) => !open)}>
          {rawOpen ? 'Hide raw JSON' : 'Show raw JSON'}
        </button>
      </div>
      <JsonValue value={parsed} />
      {rawOpen ? <pre className="raw-json">{JSON.stringify(parsed ?? {}, null, 2)}</pre> : null}
    </section>
  )
}
