# warm-path

## Local development

The canonical full-stack command is:

```powershell
npm run dev:all
```

Wait for `All services are ready.`, then open
`http://localhost:5173`. The orchestrator validates, starts, monitors, and
recovers the Playwright API, n8n, and Vite. On Ctrl+C it stops only processes
that it owns.

For isolated debugging, `npm start`, `npm run n8n`, and `npm run frontend`
remain available. Do not normally mix these individual commands with
`npm run dev:all`; services already running before the orchestrator are treated
as externally owned and are monitored but not stopped.

## Responsible Use

Use this project only where your account, the target site Terms of Service, robots/extraction policies, and applicable law allow it. The main scraping scripts intentionally process small batches, add delays between page loads, retry only a limited number of times with backoff, cache profile results under data/*.json, and stop when rate-limit or blocking signals are detected.

This project should not try to bypass anti-bot systems. If a site blocks, rate-limits, asks for verification, or otherwise signals that automated access is unwanted, stop the run and use cached data or official/manual workflows instead.

Useful environment controls:

- PROFILE_LIMIT: cap how many records are processed in a run.
- BATCH_SIZE: keep this small; defaults are 3-4 depending on the script.
- N8N_MIN_RUN_INTERVAL_MS: minimum time between scrape runs; default is 6 hours.
- N8N_MAX_URLS_PER_RUN: hard cap for n8n-triggered scrape runs; default is 25.

n8n endpoints:

- GET /ranked-mutuals: read stored rankings only.
- POST /analyze-mutuals: analyze cached/stored results only; does not start Playwright.
- POST /rank-mutuals: scrapes only missing uncached URLs by default, then analyzes cached results. Use cacheOnly:true to force no scraping. Use refresh:true only for deliberate, infrequent refreshes.
