# ============================
# Warm Path Finder Development
# ============================

$projectRoot = $PSScriptRoot

# Start Playwright API
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$projectRoot'; npm start"

# Start n8n at the endpoint already configured in .env.
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$projectRoot'; npm run n8n"

# Start Vite dashboard.
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$projectRoot'; npm run frontend"

Write-Host ""
Write-Host "========================================"
Write-Host " Warm Path Finder Development Started"
Write-Host "========================================"
Write-Host "Playwright : http://localhost:3000"
Write-Host "Health     : http://localhost:3000/health"
Write-Host "n8n        : http://localhost:5678 (configured extraction endpoint)"
Write-Host "Dashboard  : http://localhost:5173"
Write-Host "========================================"
