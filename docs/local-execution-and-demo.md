# Local execution and hosted demo

Warm Path Finder has two explicit dashboard modes.

## Fully functional local mode

Create `dashboard/.env.local` (never commit real credentials):

```dotenv
VITE_APP_MODE=local
VITE_PLAYWRIGHT_SERVER_URL=http://localhost:3000
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

From the repository root, run:

```powershell
npm run dev:all
```

Wait for `All services are ready.`, then open `http://localhost:5173`. This
canonical command owns and continuously monitors the Playwright API, n8n, and
Vite dashboard. The dashboard calls
`POST http://localhost:3000/api/searches/start`; the existing extraction webhook
configuration remains server-side.

For isolated debugging only, use `npm start`, `npm run n8n`, or
`npm run frontend`. Do not normally mix those commands with `dev:all`. A
service that was already running is validated and monitored as reused, and
Ctrl+C stops only services owned by the orchestrator.

## Read-only Vercel demo mode

Configure only:

```dotenv
VITE_APP_MODE=demo
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Do not configure `VITE_PLAYWRIGHT_SERVER_URL` in Vercel. Historical Supabase
reads and realtime refresh remain available. Start, stop, and delete actions
show a local-execution message and make no execution request or mutation.

A browser loaded from Vercel cannot call a service bound to the user's
`localhost`: that address refers to the visitor's own machine. Full execution
therefore remains local. A future hosted execution mode would require a
persistent public Playwright host and a separate, explicitly designed security
model; it is not a fallback in this architecture.
