# ============================
# Warm Path Finder Development
# ============================

$projectRoot = $PSScriptRoot

Set-Location -LiteralPath $projectRoot
Write-Host "Starting the canonical Warm Path Finder local environment..."
Write-Host "Press Ctrl+C in this terminal to stop orchestrator-owned services."
npm run dev:all
