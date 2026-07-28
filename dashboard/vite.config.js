import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const readEnv = (name) => Object.prototype.hasOwnProperty.call(process.env, name)
    ? process.env[name]
    : fileEnv[name]
  const configuredMode = String(readEnv('VITE_APP_MODE') || (mode === 'production' ? 'demo' : 'local')).trim().toLowerCase()

  if (!['local', 'demo'].includes(configuredMode)) {
    throw new Error(`Unsupported VITE_APP_MODE "${configuredMode}". Expected "local" or "demo".`)
  }
  if (configuredMode === 'local' && !String(readEnv('VITE_PLAYWRIGHT_SERVER_URL') || '').trim()) {
    throw new Error('VITE_PLAYWRIGHT_SERVER_URL is required when VITE_APP_MODE=local.')
  }

  return {
    plugins: [react()],
  }
})
