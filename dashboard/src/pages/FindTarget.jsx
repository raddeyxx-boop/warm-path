import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { initializeTargetSearch, prepareInitializedTargetSearch } from '../services/targetSearchService'

const initialForm = {
  targetName: '',
  currentCompany: '',
  linkedinName: '',
  location: '',
  keywords: '',
  companyFilter: '',
  schoolFilter: '',
}

const requiredFields = ['targetName', 'currentCompany', 'linkedinName', 'location']

function getRequiredErrors(form) {
  return Object.fromEntries(
    requiredFields
      .filter((field) => !form[field].trim())
      .map((field) => [field, 'This field is required.']),
  )
}

export function FindTarget() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [touched, setTouched] = useState({})
  const [submitPhase, setSubmitPhase] = useState('idle')
  const [result, setResult] = useState(null)
  const [pendingInitialization, setPendingInitialization] = useState(null)
  const [submitError, setSubmitError] = useState('')
  const errors = getRequiredErrors(form)

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setResult(null)
    setPendingInitialization(null)
    setSubmitError('')
  }

  function handleBlur(event) {
    setTouched((current) => ({ ...current, [event.target.name]: true }))
  }

  function fieldError(name) {
    return touched[name] ? errors[name] : undefined
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const nextErrors = getRequiredErrors(form)

    if (Object.keys(nextErrors).length) {
      setTouched(Object.fromEntries(requiredFields.map((field) => [field, true])))
      setResult(null)
      return
    }

    const normalizedForm = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()]),
    )
    setForm(normalizedForm)
    setSubmitPhase('initializing')
    setResult(null)
    setSubmitError('')

    try {
      let initialization = pendingInitialization
      if (!initialization) {
        initialization = await initializeTargetSearch(normalizedForm)
        if (!initialization.ok) {
          setSubmitError(initialization.message)
          setResult(initialization)
          return
        }
        setPendingInitialization(initialization)
        setForm(initialization.normalizedForm)
      }

      setSubmitPhase('preparing')
      const preparation = await prepareInitializedTargetSearch(
        initialization.workflowRunId,
        initialization.searchRequestId,
      )
      setResult({ ...initialization, preparation })
      setPendingInitialization(null)
      navigate('/runs')
    } catch (error) {
      setSubmitError(error.message || 'Unable to initialize the search. Please try again.')
    } finally {
      setSubmitPhase('idle')
    }
  }

  function renderField({ name, label, placeholder, required = false, help }) {
    const error = fieldError(name)
    const helpId = help ? `${name}-help` : undefined
    const errorId = error ? `${name}-error` : undefined
    const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

    return (
      <label htmlFor={name}>
        <span>{label}</span>
        <input
          id={name}
          name={name}
          type="text"
          value={form[name]}
          placeholder={placeholder}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={handleChange}
          onBlur={handleBlur}
        />
        {help ? <small id={helpId} className="field-help">{help}</small> : null}
        {error ? <small id={errorId} className="field-error">{error}</small> : null}
      </label>
    )
  }

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div>
          <h2>Find a New Target</h2>
          <p>Enter a target and optional people filters to start a new warm-path search.</p>
        </div>
      </div>

      <form className="target-search-form" onSubmit={handleSubmit} noValidate>
        <section className="card target-form-section" aria-labelledby="target-information-heading">
          <div className="target-form-heading">
            <h3 id="target-information-heading">Target Information</h3>
          </div>
          <div className="target-form-grid">
            {renderField({ name: 'targetName', label: 'Target Name', placeholder: 'e.g. Sarah Chen', required: true })}
            {renderField({ name: 'currentCompany', label: 'Current Company', placeholder: 'e.g. Stripe', required: true })}
            {renderField({ name: 'linkedinName', label: 'LinkedIn Name', placeholder: 'Name as shown on LinkedIn', required: true })}
            {renderField({ name: 'location', label: 'Location', placeholder: 'e.g. San Francisco Bay Area', required: true })}
          </div>
        </section>

        <section className="card target-form-section" aria-labelledby="people-filters-heading">
          <div className="target-form-heading">
            <h3 id="people-filters-heading">People Filters</h3>
          </div>
          <div className="target-form-grid">
            {renderField({ name: 'keywords', label: 'Keywords', placeholder: 'e.g. fintech, partnerships, enterprise', help: 'Separate multiple keywords with commas.' })}
            {renderField({ name: 'companyFilter', label: 'Company', placeholder: 'e.g. Google, Meta, OpenAI', help: 'Separate multiple companies with commas.' })}
            {renderField({ name: 'schoolFilter', label: 'School', placeholder: 'e.g. Stanford University', help: 'Separate multiple schools with commas.' })}
          </div>
        </section>

        {result?.preparation?.success ? (
          <p className="form-message form-message-info" role="status">
            {result.preparation.cache_hit
              ? 'Search completed using cached results.'
              : 'No cached results were found. Search is ready for execution.'}
          </p>
        ) : null}
        {submitError ? <p className="form-message form-message-error" role="alert">{submitError}</p> : null}

        <div className="card-actions">
          <button type="submit" className="button button-primary" disabled={submitPhase !== 'idle'}>
            {submitPhase === 'initializing' ? 'Initializing...' : submitPhase === 'preparing' ? 'Preparing Search...' : 'Start Search'}
          </button>
        </div>
      </form>
    </section>
  )
}
