import { defineConfig, loadEnv } from 'vite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const cwd = process.cwd()
  const env = loadEnv(mode, cwd, '')
  const configuredMode = String(env.VITE_APP_MODE || (mode === 'production' ? 'demo' : 'local')).trim().toLowerCase()
  const playwrightServerUrl = String(env.VITE_PLAYWRIGHT_SERVER_URL || '').trim()
  const envFiles = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]
    .filter((file) => existsSync(resolve(cwd, file)))

  console.info('[VITE_ENV]', {
    mode,
    cwd,
    envFiles,
    VITE_APP_MODE: configuredMode,
    VITE_PLAYWRIGHT_SERVER_URL: playwrightServerUrl || '(not set)',
  })

  if (!['local', 'demo'].includes(configuredMode)) {
    throw new Error(`Unsupported VITE_APP_MODE "${configuredMode}". Expected "local" or "demo".`)
  }
  if (configuredMode === 'local' && !playwrightServerUrl) {
    throw new Error('VITE_PLAYWRIGHT_SERVER_URL is required when VITE_APP_MODE=local.')
  }

  return {
    plugins: [react()],
  }
})
