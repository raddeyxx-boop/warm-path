# Warm Path Finder Dashboard

The React dashboard reads historical Warm Path Finder records from Supabase.
Execution is available only in explicit local mode; the Vercel deployment is a
read-only demo.

## Local mode

Create `.env.local`:

```dotenv
VITE_APP_MODE=local
VITE_PLAYWRIGHT_SERVER_URL=http://localhost:3000
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Start all services from the repository root with `npm run dev:all`. The
dashboard is served at `http://localhost:5173` and dispatches authenticated
searches to the existing Playwright API at `http://localhost:3000`.

## Vercel demo mode

Configure:

```dotenv
VITE_APP_MODE=demo
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Do not set `VITE_PLAYWRIGHT_SERVER_URL`. Demo mode retains Supabase reads and
realtime updates but blocks start, stop, and delete before any execution request
or mutation.

Install/build:

```bash
npm install
npm run build
```

Only the public Supabase anon key belongs in the frontend. Never expose a
service-role key. See `../docs/local-execution-and-demo.md` and
`docs/AUTH-ADMIN-RLS.md`.
