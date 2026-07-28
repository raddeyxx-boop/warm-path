import { getAppMode } from '../config/appMode.js'

export class PlaywrightServerConfigurationError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'PlaywrightServerConfigurationError'
    this.code = 'PLAYWRIGHT_SERVER_NOT_CONFIGURED'
  }
}

export function normalizePlaywrightServerBaseUrl(
  rawValue,
  { appMode = 'local', dashboardHostname = '' } = {},
) {
  if (appMode !== 'local') {
    throw new PlaywrightServerConfigurationError(
      'The Playwright server URL is unavailable in demo mode.',
    )
  }
  const configuredUrl = String(rawValue || '').trim().replace(/\/+$/, '')
  if (!configuredUrl) {
    throw new PlaywrightServerConfigurationError(
      'VITE_PLAYWRIGHT_SERVER_URL is required when VITE_APP_MODE=local.',
    )
  }

  try {
    const url = new URL(configuredUrl)
    const workerIsLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Local mode requires an HTTP or HTTPS server URL.')
    }
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error('Local mode requires a localhost Playwright server URL.')
    }
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return { url, workerIsLocal, dashboardHostname }
  } catch (error) {
    if (error instanceof PlaywrightServerConfigurationError) throw error
    throw new PlaywrightServerConfigurationError(
      'VITE_PLAYWRIGHT_SERVER_URL is required when VITE_APP_MODE=local.',
      error,
    )
  }
}

export function buildPlaywrightServerEndpoint(rawValue, endpointPath, options) {
  const configuration = normalizePlaywrightServerBaseUrl(rawValue, options)
  const path = `/${String(endpointPath || '').replace(/^\/+/, '')}`
  const url = new URL(configuration.url.href)
  url.pathname = `${url.pathname}${path}`.replace(/\/{2,}/g, '/')
  return { url, workerIsLocal: configuration.workerIsLocal }
}

export function getPlaywrightServerEndpoint(endpointPath) {
  let endpoint
  try {
    endpoint = buildPlaywrightServerEndpoint(
      import.meta.env.VITE_PLAYWRIGHT_SERVER_URL,
      endpointPath,
      {
        appMode: getAppMode(),
        dashboardHostname: globalThis.location?.hostname || '',
      },
    )
  } catch (error) {
    console.info('[PLAYWRIGHT_SERVER_CONFIG]', {
      configured: false,
      protocol: null,
      hostname: null,
      endpoint_path: `/${String(endpointPath || '').replace(/^\/+/, '')}`,
      is_localhost: false,
      build_mode: import.meta.env.MODE,
    })
    throw error
  }
  console.info('[PLAYWRIGHT_SERVER_CONFIG]', {
    configured: true,
    protocol: endpoint.url.protocol,
    hostname: endpoint.url.hostname,
    endpoint_path: endpoint.url.pathname,
    is_localhost: endpoint.workerIsLocal,
    build_mode: import.meta.env.MODE,
  })
  return endpoint.url
}
