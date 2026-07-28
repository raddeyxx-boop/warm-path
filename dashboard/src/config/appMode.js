export const DEMO_MODE_MESSAGE =
  'This hosted dashboard is a read-only demo. Run the project locally to start, stop, or delete workflows.'

export class AppModeConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AppModeConfigurationError'
    this.code = 'APP_MODE_INVALID'
  }
}

export class DemoModeExecutionError extends Error {
  constructor() {
    super(DEMO_MODE_MESSAGE)
    this.name = 'DemoModeExecutionError'
    this.code = 'DEMO_MODE_EXECUTION_BLOCKED'
  }
}

export function resolveAppMode(rawValue, { dev = false } = {}) {
  const value = String(rawValue || '').trim().toLowerCase()
  if (value === 'local' || value === 'demo') return value
  if (!value && dev) return 'local'
  if (!value) return 'demo'
  throw new AppModeConfigurationError(
    `Unsupported VITE_APP_MODE "${value}". Use "local" or "demo".`,
  )
}

export function getAppMode() {
  const rawValue = import.meta.env.VITE_APP_MODE
  const mode = resolveAppMode(rawValue, { dev: import.meta.env.DEV === true })
  if (!rawValue && import.meta.env.PROD) {
    console.warn('[APP_MODE_CONFIG] VITE_APP_MODE is missing; execution is disabled.')
  }
  return mode
}

export function isLocalMode() {
  return getAppMode() === 'local'
}

export function isDemoMode() {
  return getAppMode() === 'demo'
}

export function assertLocalExecutionAvailable(action, page, appMode = getAppMode()) {
  if (appMode === 'local') return
  console.info('[DEMO_MODE_EXECUTION_BLOCKED]', {
    action,
    page,
    timestamp: new Date().toISOString(),
  })
  throw new DemoModeExecutionError()
}

export function logAppModeConfig() {
  const appMode = getAppMode()
  console.info('[APP_MODE_CONFIG]', {
    app_mode: appMode,
    build_mode: import.meta.env.MODE,
    hostname: globalThis.location?.hostname || null,
    local_execution_enabled: appMode === 'local',
    playwright_server_configured: appMode === 'local' &&
      Boolean(String(import.meta.env.VITE_PLAYWRIGHT_SERVER_URL || '').trim()),
  })
}
