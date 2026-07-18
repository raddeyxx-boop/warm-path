# Warm Path Finder Dashboard

React dashboard for viewing Warm Path Finder records already stored in Supabase. It is a separate read-only frontend and does not run the Playwright scraper, n8n workflow, ranking scripts, or Supabase write pipeline.

For authentication, admin user management, RLS, and n8n ownership setup, see [docs/AUTH-ADMIN-RLS.md](docs/AUTH-ADMIN-RLS.md).

## What It Shows

- Overview statistics from `workflow_runs`, `ranked_candidates`, and `top_candidates`
- Top candidate profile cards
- Searchable, filterable, paginated ranked candidates
- Candidate details with readable `profile`, `analysis`, and `ai_analysis` sections
- Workflow runs and optional run-linked candidates when `workflow_run_id` or `run_id` exists

## Installation

```bash
cd dashboard
npm install
```

## Environment Variables

Create `dashboard/.env` from `.env.example`:

```bash
VITE_SUPABASE_URL=https://pltmwpylraikuecidrye.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_API_BASE_URL=http://localhost:3000
```

Only use the Supabase anon key in this frontend. Never use or commit a service-role key.

## Local Development

```bash
npm run dev
```

Default local URL:

```bash
http://localhost:5173
```

## Production Build

```bash
npm run build
npm run preview
```

## Supabase Configuration

Expected tables:

- `workflow_runs`
- `ranked_candidates`
- `top_candidates`

The dashboard reads optional fields defensively. Missing nullable fields render as `Not available` rather than breaking the UI.

See `docs/SUPABASE-SETUP.md` for read-only RLS examples.

## Read-Only Security Model

The dashboard only performs `SELECT` queries through the Supabase JavaScript client. It does not call `insert`, `update`, `upsert`, `delete`, RPC write functions, or schema-changing SQL.

Protect the public anon key with Row Level Security policies that grant only read access to the tables used by this app.

## Troubleshooting

- Missing environment variables: verify `dashboard/.env`, then restart Vite.
- `Supabase denied read access`: add read-only RLS policies for the anon or authenticated role.
- `table or column unavailable`: confirm the table exists and is exposed through the public API schema.
- Empty views: confirm n8n has written rows and the anon/authenticated role can read them.
- LinkedIn buttons missing: the row has no valid LinkedIn URL.

## Deployment

Deploy the `dashboard` folder to any static host that supports Vite builds, such as Vercel, Netlify, Cloudflare Pages, or an internal static server.

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```
