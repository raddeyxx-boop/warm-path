import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/darkDashboard.css'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { logAppModeConfig } from './config/appMode'

logAppModeConfig()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
