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

This starts the existing Playwright API, repository n8n integration server, and
Vite dashboard. The dashboard calls `POST http://localhost:3000/api/searches/start`;
the existing extraction webhook configuration remains server-side.

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
