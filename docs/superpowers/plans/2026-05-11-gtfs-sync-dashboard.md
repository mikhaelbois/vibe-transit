# GTFS Sync Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js 14 PoC dashboard where an authenticated user can sync GTFS static feed data (stops + routes) into Supabase Postgres via ZIP upload or API URL, and view sync history and row counts.

**Architecture:** All sync logic lives in a single Next.js API route (`POST /api/sync`) that accepts either a multipart ZIP upload or a JSON body with a URL, parses the GTFS files, truncates target tables, and bulk-inserts in batches of 1,000. Supabase handles auth (email/password), the database, and RLS. Next.js middleware protects all `/dashboard/*` routes.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, `@supabase/ssr`, `@supabase/supabase-js`, `jszip`, `papaparse`

---

## File Map

```
.
├── .env.local                              # Supabase credentials (not committed)
├── .env.example                            # Template for env vars
├── middleware.ts                           # Auth guard for /dashboard/*
├── app/
│   ├── globals.css                         # Tailwind base styles
│   ├── layout.tsx                          # Root HTML shell
│   ├── page.tsx                            # Redirect → /dashboard/sync
│   ├── login/
│   │   └── page.tsx                        # Email/password login form
│   ├── dashboard/
│   │   ├── layout.tsx                      # Sidebar wrapper layout
│   │   ├── sync/
│   │   │   └── page.tsx                    # Thin shell for SyncForm
│   │   ├── history/
│   │   │   └── page.tsx                    # Server component: sync_runs table
│   │   └── data/
│   │       └── page.tsx                    # Server component: row count cards
│   └── api/
│       └── sync/
│           └── route.ts                    # POST /api/sync pipeline
├── components/
│   ├── Sidebar.tsx                         # Client component: nav + sign-out
│   ├── SignOutButton.tsx                   # Client component: sign-out action
│   └── SyncForm.tsx                        # Client component: sync trigger UI
├── lib/
│   ├── supabase/
│   │   ├── client.ts                       # Browser Supabase client
│   │   ├── server.ts                       # Server Supabase client (SSR cookies)
│   │   └── service.ts                      # Service role client (bypasses RLS)
│   └── gtfs/
│       └── parse.ts                        # Unzip + CSV parse → typed row arrays
└── supabase/
    └── migrations/
        └── 001_initial.sql                 # Schema: sync_runs, stops, routes + RLS
```

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: `package.json` (via CLI)
- Create: `.env.example`
- Create: `.gitignore` additions

- [ ] **Step 1: Run create-next-app**

```bash
cd /Users/mikhaelbois/www/vibe-transit
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir=false \
  --import-alias="@/*" \
  --no-turbopack
```

When prompted "would you like to use `src/` directory?" choose **No**.

- [ ] **Step 2: Install GTFS parsing and Supabase dependencies**

```bash
npm install @supabase/ssr @supabase/supabase-js jszip papaparse
npm install -D @types/papaparse
```

- [ ] **Step 3: Create .env.example**

```bash
cat > .env.example << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EOF
```

- [ ] **Step 4: Add .env.local to .gitignore**

Open `.gitignore` and confirm `.env.local` is listed. If not, add it:

```
.env.local
```

- [ ] **Step 5: Verify the dev server starts**

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000`, no errors in terminal.

Kill the server with `Ctrl+C`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Supabase and GTFS deps"
```

---

## Task 2: Supabase project setup and database migration

**Files:**
- Create: `supabase/migrations/001_initial.sql`
- Create: `.env.local` (manual step — not committed)

- [ ] **Step 1: Create a Supabase project**

1. Go to https://supabase.com and sign in.
2. Click **New project**.
3. Fill in name (e.g. `vibe-transit`), choose a region, set a database password.
4. Wait for the project to provision (about 60 seconds).

- [ ] **Step 2: Copy credentials into .env.local**

In your Supabase project: **Settings → API**.

Create `/Users/mikhaelbois/www/vibe-transit/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Settings → API>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from Settings → API>
```

> **Security note:** `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It must never be exposed to the browser — only used in server-side API routes.

- [ ] **Step 3: Write the migration file**

Create `supabase/migrations/001_initial.sql`:

```sql
-- sync_runs: records every sync attempt with user attribution.
--
-- Audit log note: triggered_by_* fields cover sync-level attribution.
-- Supabase also exposes auth.audit_log_entries for login/logout events at no cost.
-- TODO (future): add a standalone audit_log table for broader user activity tracking.
create table public.sync_runs (
  id                    uuid        primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  source_type           text        not null check (source_type in ('zip', 'api')),
  source_url            text,
  status                text        not null check (status in ('success', 'error')),
  error_message         text,
  rows_inserted         jsonb,
  duration_ms           int,
  triggered_by_user_id  uuid        references auth.users(id),
  triggered_by_email    text
);

alter table public.sync_runs enable row level security;

create policy "Authenticated users can read sync_runs"
  on public.sync_runs for select
  to authenticated using (true);

create policy "Service role can insert sync_runs"
  on public.sync_runs for insert
  to service_role with check (true);

-- stops: core GTFS stops.txt fields.
-- TODO: add stop_code, stop_url, location_type, parent_station, wheelchair_boarding
--       when full GTFS spec coverage is implemented.
create table public.stops (
  stop_id    text    primary key,
  stop_name  text,
  stop_lat   float8,
  stop_lon   float8,
  stop_desc  text,
  zone_id    text
);

alter table public.stops enable row level security;

create policy "Authenticated users can read stops"
  on public.stops for select
  to authenticated using (true);

create policy "Service role can manage stops"
  on public.stops for all
  to service_role using (true) with check (true);

-- routes: core GTFS routes.txt fields.
-- TODO: add route_desc, route_url, route_sort_order, continuous_pickup, continuous_drop_off
--       when full GTFS spec coverage is implemented.
create table public.routes (
  route_id          text primary key,
  agency_id         text,
  route_short_name  text,
  route_long_name   text,
  route_type        int,
  route_color       text
);

alter table public.routes enable row level security;

create policy "Authenticated users can read routes"
  on public.routes for select
  to authenticated using (true);

create policy "Service role can manage routes"
  on public.routes for all
  to service_role using (true) with check (true);

-- TODO: Add tables for the remaining GTFS files to reach full spec coverage:
--   trips, stop_times, calendar, calendar_dates, shapes, agency,
--   fare_attributes, fare_rules, frequencies, transfers, feed_info

-- Helper function called by the sync pipeline to wipe tables before re-insert.
-- Using security definer so the service role can call it.
-- TODO: extend this function as additional tables are added to the pipeline.
create or replace function public.truncate_gtfs_tables()
returns void
language plpgsql
security definer
as $$
begin
  truncate table public.stops, public.routes;
end;
$$;

grant execute on function public.truncate_gtfs_tables() to service_role;
```

- [ ] **Step 4: Run the migration in Supabase**

In your Supabase project: **SQL Editor → New query**.
Paste the entire contents of `supabase/migrations/001_initial.sql` and click **Run**.

Expected: no errors. You can verify in **Table Editor** that `sync_runs`, `stops`, and `routes` now exist.

- [ ] **Step 5: Create a test user for manual testing**

In Supabase: **Authentication → Users → Invite user**.
Enter your email address and set a password. You'll use this to log in during testing.

- [ ] **Step 6: Commit the migration file**

```bash
git add supabase/migrations/001_initial.sql .env.example
git commit -m "feat: add Supabase schema migration (sync_runs, stops, routes)"
```

---

## Task 3: Supabase client utilities

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/service.ts`

- [ ] **Step 1: Create the browser client**

`lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Create the server client**

`lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — safe to ignore.
            // Middleware handles session refresh.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Create the service role client**

`lib/supabase/service.ts`:

```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service role client bypasses RLS — use only in server-side API routes.
// Never import this in client components or expose the key to the browser.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/
git commit -m "feat: add Supabase browser, server, and service role client utilities"
```

---

## Task 4: Auth middleware

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Create middleware.ts**

`middleware.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — required by @supabase/ssr to keep the session alive.
  const { data: { user } } = await supabase.auth.getUser()

  // Unauthenticated → /login
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Already authenticated → skip login page
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard/sync'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: add Next.js middleware to protect /dashboard routes"
```

---

## Task 5: Root layout, redirect, and login page

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Create: `app/login/page.tsx`

- [ ] **Step 1: Update app/layout.tsx**

Replace the generated content of `app/layout.tsx` with:

```typescript
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Vibe Transit',
  description: 'GTFS Sync Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Replace app/page.tsx with a redirect**

```typescript
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/dashboard/sync')
}
```

- [ ] **Step 3: Create app/login/page.tsx**

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard/sync')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm p-8 bg-slate-900 rounded-lg border border-slate-800">
        <h1 className="text-xl font-bold text-white mb-6">■ Vibe Transit</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Start dev server and verify login page renders**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: redirected to `/login`, login form visible with email + password fields.

Kill the server with `Ctrl+C`.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "feat: add root layout, redirect, and login page"
```

---

## Task 6: Dashboard shell — layout and sidebar

**Files:**
- Create: `components/SignOutButton.tsx`
- Create: `components/Sidebar.tsx`
- Create: `app/dashboard/layout.tsx`
- Create: `app/dashboard/sync/page.tsx` (placeholder)
- Create: `app/dashboard/history/page.tsx` (placeholder)
- Create: `app/dashboard/data/page.tsx` (placeholder)

- [ ] **Step 1: Create SignOutButton**

`components/SignOutButton.tsx`:

```typescript
'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-red-400 hover:text-red-300 transition-colors"
    >
      Sign out
    </button>
  )
}
```

- [ ] **Step 2: Create Sidebar**

`components/Sidebar.tsx`:

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'

const navItems = [
  { href: '/dashboard/sync', label: 'Sync' },
  { href: '/dashboard/history', label: 'History' },
  { href: '/dashboard/data', label: 'Data' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-48 bg-slate-900 border-r border-slate-800 flex flex-col min-h-screen flex-shrink-0">
      <div className="p-4 border-b border-slate-800">
        <span className="text-violet-400 font-bold text-sm">■ Vibe Transit</span>
      </div>
      <nav className="flex-1 py-2">
        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-4 py-2 text-sm transition-colors ${
                active
                  ? 'text-violet-400 border-l-2 border-violet-500 bg-violet-500/10'
                  : 'text-slate-400 hover:text-slate-200 border-l-2 border-transparent'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <SignOutButton />
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: Create dashboard layout**

`app/dashboard/layout.tsx`:

```typescript
import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 4: Add placeholder pages for each dashboard route**

`app/dashboard/sync/page.tsx`:

```typescript
export default function SyncPage() {
  return <p className="text-slate-400">Sync form coming soon.</p>
}
```

`app/dashboard/history/page.tsx`:

```typescript
export default function HistoryPage() {
  return <p className="text-slate-400">History coming soon.</p>
}
```

`app/dashboard/data/page.tsx`:

```typescript
export default function DataPage() {
  return <p className="text-slate-400">Data preview coming soon.</p>
}
```

- [ ] **Step 5: Verify the dashboard shell works end-to-end**

```bash
npm run dev
```

1. Open `http://localhost:3000` — redirects to `/login`.
2. Sign in with the test user created in Task 2.
3. Expected: redirected to `/dashboard/sync`, sidebar visible with Sync / History / Data links.
4. Click each nav link — expected: URL changes, placeholder text updates, active link highlights.
5. Click **Sign out** — expected: redirected back to `/login`.

Kill the server with `Ctrl+C`.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/ components/
git commit -m "feat: add dashboard shell with sidebar navigation and sign-out"
```

---

## Task 7: GTFS parse utility

**Files:**
- Create: `lib/gtfs/parse.ts`

- [ ] **Step 1: Create lib/gtfs/parse.ts**

```typescript
import JSZip from 'jszip'
import Papa from 'papaparse'

// Types for the two GTFS tables implemented in this PoC.
// TODO: Add types for trips, stop_times, calendar, calendar_dates, shapes,
//       agency, fare_attributes, fare_rules, frequencies, transfers, feed_info
//       as each table is added to the pipeline.

export interface StopRow {
  stop_id: string
  stop_name: string | null
  stop_lat: number | null
  stop_lon: number | null
  stop_desc: string | null
  zone_id: string | null
}

export interface RouteRow {
  route_id: string
  agency_id: string | null
  route_short_name: string | null
  route_long_name: string | null
  route_type: number | null
  route_color: string | null
}

export interface ParsedGtfs {
  stops: StopRow[]
  routes: RouteRow[]
}

export async function parseGtfsZip(buffer: Buffer): Promise<ParsedGtfs> {
  const zip = await JSZip.loadAsync(buffer)

  // TODO: Extract and parse additional GTFS files as tables are added:
  // trips.txt, stop_times.txt, calendar.txt, calendar_dates.txt,
  // shapes.txt, agency.txt, fare_attributes.txt, fare_rules.txt,
  // frequencies.txt, transfers.txt, feed_info.txt

  const stopsFile = zip.file('stops.txt')
  const routesFile = zip.file('routes.txt')

  if (!stopsFile) throw new Error('stops.txt not found in ZIP')
  if (!routesFile) throw new Error('routes.txt not found in ZIP')

  const [stopsText, routesText] = await Promise.all([
    stopsFile.async('string'),
    routesFile.async('string'),
  ])

  return {
    stops: parseStops(stopsText),
    routes: parseRoutes(routesText),
  }
}

function parseCsv(text: string): Record<string, string>[] {
  // papaparse handles BOM, CRLF line endings, and quoted fields — all common in GTFS exports.
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })
  return result.data
}

function parseStops(text: string): StopRow[] {
  return parseCsv(text).map((row) => ({
    stop_id: row['stop_id'],
    stop_name: row['stop_name'] || null,
    stop_lat: row['stop_lat'] ? parseFloat(row['stop_lat']) : null,
    stop_lon: row['stop_lon'] ? parseFloat(row['stop_lon']) : null,
    stop_desc: row['stop_desc'] || null,
    zone_id: row['zone_id'] || null,
  }))
}

function parseRoutes(text: string): RouteRow[] {
  return parseCsv(text).map((row) => ({
    route_id: row['route_id'],
    agency_id: row['agency_id'] || null,
    route_short_name: row['route_short_name'] || null,
    route_long_name: row['route_long_name'] || null,
    route_type: row['route_type'] ? parseInt(row['route_type'], 10) : null,
    route_color: row['route_color'] || null,
  }))
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/gtfs/
git commit -m "feat: add GTFS ZIP + CSV parse utility (stops, routes)"
```

---

## Task 8: Sync API route

**Files:**
- Create: `app/api/sync/route.ts`

- [ ] **Step 1: Create app/api/sync/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/service'
import { parseGtfsZip } from '@/lib/gtfs/parse'

// APPROACH: All-in-one Next.js API route.
//
// PRO: Single codebase, simple Vercel deployment, no extra infrastructure.
// CON: Vercel serverless functions have a 60s execution timeout.
//      Fine for small GTFS feeds (this PoC). Risky for large production feeds.
//
// ALTERNATIVE A — Supabase Edge Functions (Deno):
//   Runs closer to the database, removes Vercel dependency.
//   Natural upgrade path when moving to production.
//   See: https://supabase.com/docs/guides/functions
//
// ALTERNATIVE B — Background job queue (BullMQ + Redis):
//   Handles arbitrarily large feeds without timeout risk.
//   Requires additional infrastructure (Redis, worker process).
//   See: https://docs.bullmq.io/

const BATCH_SIZE = 1_000

export async function POST(request: NextRequest) {
  const start = Date.now()
  const serviceClient = createServiceClient()

  // Extract the authenticated user for attribution.
  // Uses the anon client + session cookie — not the service role client.
  let userId: string | null = null
  let userEmail: string | null = null

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll() {}, // No-op in API routes
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
    userEmail = user?.email ?? null
  } catch {
    // Non-fatal: sync proceeds without attribution if session extraction fails.
  }

  // --- Input handling ---
  let buffer: Buffer
  let sourceType: 'zip' | 'api'
  let sourceUrl: string | null = null

  try {
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) throw new Error('No file provided in form data')
      buffer = Buffer.from(await file.arrayBuffer())
      sourceType = 'zip'
    } else {
      const body = await request.json()
      if (!body.url) throw new Error('No URL provided in request body')
      sourceUrl = body.url as string
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
      }
      buffer = Buffer.from(await response.arrayBuffer())
      sourceType = 'api'
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown input error'
    await recordSyncRun(serviceClient, {
      source_type: 'api', source_url: sourceUrl, status: 'error',
      error_message: message, rows_inserted: null,
      duration_ms: Date.now() - start,
      triggered_by_user_id: userId, triggered_by_email: userEmail,
    })
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // --- Parse ---
  let parsed
  try {
    parsed = await parseGtfsZip(buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ZIP parse error'
    await recordSyncRun(serviceClient, {
      source_type: sourceType!, source_url: sourceUrl, status: 'error',
      error_message: message, rows_inserted: null,
      duration_ms: Date.now() - start,
      triggered_by_user_id: userId, triggered_by_email: userEmail,
    })
    return NextResponse.json({ error: message }, { status: 422 })
  }

  // --- Truncate + insert ---
  try {
    // STRATEGY: Full truncate + re-insert on every sync.
    //
    // PRO: Simple, no key-collision edge cases.
    // KNOWN LIMITATION: A failure after truncate but before insert completes
    //   leaves the tables empty until the next successful sync.
    //   Fix in production: wrap in a transaction or use a shadow-table swap.
    //
    // FUTURE: Upsert using stable GTFS primary keys (stop_id, route_id, etc.)
    //   for incremental syncs without any downtime window.
    const { error: truncateError } = await serviceClient.rpc('truncate_gtfs_tables')
    if (truncateError) throw new Error(`Truncate failed: ${truncateError.message}`)

    // TODO: Add batchInsert calls for additional tables as they are implemented.
    await batchInsert(serviceClient, 'stops', parsed.stops)
    await batchInsert(serviceClient, 'routes', parsed.routes)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database error'
    await recordSyncRun(serviceClient, {
      source_type: sourceType!, source_url: sourceUrl, status: 'error',
      error_message: message, rows_inserted: null,
      duration_ms: Date.now() - start,
      triggered_by_user_id: userId, triggered_by_email: userEmail,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const rowsInserted = {
    stops: parsed.stops.length,
    routes: parsed.routes.length,
  }

  const syncRun = await recordSyncRun(serviceClient, {
    source_type: sourceType!,
    source_url: sourceUrl,
    status: 'success',
    error_message: null,
    rows_inserted: rowsInserted,
    duration_ms: Date.now() - start,
    triggered_by_user_id: userId,
    triggered_by_email: userEmail,
  })

  return NextResponse.json({ syncRun, rowsInserted })
}

async function batchInsert(
  client: ReturnType<typeof createServiceClient>,
  table: string,
  rows: Record<string, unknown>[]
) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await client.from(table).insert(batch)
    if (error) throw new Error(`Insert into ${table} failed: ${error.message}`)
  }
}

type SyncRunInput = {
  source_type: 'zip' | 'api'
  source_url: string | null
  status: 'success' | 'error'
  error_message: string | null
  rows_inserted: Record<string, number> | null
  duration_ms: number
  triggered_by_user_id: string | null
  triggered_by_email: string | null
}

async function recordSyncRun(
  client: ReturnType<typeof createServiceClient>,
  data: SyncRunInput
) {
  const { data: run, error } = await client
    .from('sync_runs')
    .insert(data)
    .select()
    .single()
  if (error) console.error('Failed to record sync run:', error.message)
  return run
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/
git commit -m "feat: add POST /api/sync route (truncate + batch insert pipeline)"
```

---

## Task 9: Sync view

**Files:**
- Create: `components/SyncForm.tsx`
- Modify: `app/dashboard/sync/page.tsx`

- [ ] **Step 1: Create SyncForm component**

`components/SyncForm.tsx`:

```typescript
'use client'

import { useState, useRef } from 'react'

type SyncMode = 'zip' | 'api'

interface SyncResult {
  success: boolean
  message: string
}

export default function SyncForm() {
  const [mode, setMode] = useState<SyncMode>('zip')
  const [apiUrl, setApiUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSync() {
    setLoading(true)
    setResult(null)

    try {
      let response: Response

      if (mode === 'zip') {
        if (!file) throw new Error('Please select a ZIP file')
        const formData = new FormData()
        formData.append('file', file)
        response = await fetch('/api/sync', { method: 'POST', body: formData })
      } else {
        if (!apiUrl.trim()) throw new Error('Please enter a URL')
        response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: apiUrl.trim() }),
        })
      }

      const data = await response.json()

      if (!response.ok) {
        setResult({ success: false, message: data.error ?? 'Sync failed' })
      } else {
        const counts = Object.entries(
          data.rowsInserted as Record<string, number>
        )
          .map(([table, count]) => `${count.toLocaleString()} ${table}`)
          .join(', ')
        setResult({ success: true, message: `Synced: ${counts}` })
      }
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.name.endsWith('.zip')) setFile(dropped)
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
        Sync GTFS Data
      </h1>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {(['zip', 'api'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setResult(null) }}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              mode === m
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {m === 'zip' ? 'ZIP Upload' : 'API URL'}
          </button>
        ))}
      </div>

      {/* Input area */}
      {mode === 'zip' ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-violet-500 bg-violet-500/10'
              : 'border-slate-700 hover:border-slate-500'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <p className="text-sm text-slate-300">{file.name}</p>
          ) : (
            <>
              <p className="text-sm text-slate-400">Drop a GTFS .zip here</p>
              <p className="text-xs text-violet-400 mt-1">or click to browse</p>
            </>
          )}
        </div>
      ) : (
        <input
          type="url"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="https://example.com/gtfs.zip"
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:border-violet-500 placeholder-slate-600"
        />
      )}

      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={loading}
        className="px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
      >
        {loading ? 'Syncing...' : 'Run Sync →'}
      </button>

      {/* Result pill */}
      {result && (
        <div
          className={`px-4 py-3 rounded border text-sm ${
            result.success
              ? 'bg-green-950 border-green-800 text-green-400'
              : 'bg-red-950 border-red-800 text-red-400'
          }`}
        >
          {result.success ? '✓ ' : '✗ '}
          {result.message}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Replace app/dashboard/sync/page.tsx**

```typescript
import SyncForm from '@/components/SyncForm'

export default function SyncPage() {
  return <SyncForm />
}
```

- [ ] **Step 3: Manually test the sync form**

```bash
npm run dev
```

1. Sign in and go to `/dashboard/sync`.
2. **ZIP upload test:** Download a small GTFS feed (e.g. https://transitfeeds.com or any public agency feed). Upload the ZIP. Expected: green pill with row counts.
3. **API URL test:** Switch to API URL mode, enter a GTFS feed download URL. Expected: green pill with row counts.
4. **Error test:** Enter a non-existent URL (e.g. `https://example.com/notfound.zip`). Expected: red pill with error message.
5. **Missing input test:** Click Run Sync without a file selected. Expected: red pill with "Please select a ZIP file".

Kill the server with `Ctrl+C`.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/sync/ components/SyncForm.tsx
git commit -m "feat: add sync view with ZIP upload and API URL input"
```

---

## Task 10: History view

**Files:**
- Modify: `app/dashboard/history/page.tsx`

- [ ] **Step 1: Replace app/dashboard/history/page.tsx**

```typescript
import { createClient } from '@/lib/supabase/server'

export default async function HistoryPage() {
  const supabase = createClient()
  const { data: runs } = await supabase
    .from('sync_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div>
      <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-6">
        Sync History
      </h1>

      {!runs || runs.length === 0 ? (
        <p className="text-slate-500 text-sm">No sync runs yet.</p>
      ) : (
        <div className="space-y-2 max-w-3xl">
          {runs.map((run) => (
            <div
              key={run.id}
              className={`bg-slate-900 rounded px-4 py-3 border-l-2 ${
                run.status === 'success'
                  ? 'border-green-500'
                  : 'border-red-500'
              }`}
            >
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span
                  className={
                    run.status === 'success' ? 'text-green-400' : 'text-red-400'
                  }
                >
                  {run.status === 'success' ? '✓' : '✗'} {run.status}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{run.source_type}</span>
                {run.source_url && (
                  <>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-500 text-xs truncate max-w-xs">
                      {run.source_url}
                    </span>
                  </>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-1 flex gap-3 flex-wrap">
                {run.rows_inserted && (
                  <span>
                    {Object.entries(
                      run.rows_inserted as Record<string, number>
                    )
                      .map(([t, c]) => `${t}: ${c.toLocaleString()}`)
                      .join(' · ')}
                  </span>
                )}
                {run.error_message && (
                  <span className="text-red-400">{run.error_message}</span>
                )}
                <span>{run.duration_ms}ms</span>
                <span>·</span>
                <span>{run.triggered_by_email ?? 'unknown'}</span>
                <span>·</span>
                <span>{new Date(run.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manually verify**

```bash
npm run dev
```

1. Navigate to `/dashboard/history`.
2. Expected: rows from previous sync tests appear, newest first, with status color, row counts, email, and timestamp.
3. Confirm a failed sync shows in red with the error message.

Kill the server with `Ctrl+C`.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/history/page.tsx
git commit -m "feat: add sync history view"
```

---

## Task 11: Data preview view

**Files:**
- Modify: `app/dashboard/data/page.tsx`

- [ ] **Step 1: Replace app/dashboard/data/page.tsx**

```typescript
import { createClient } from '@/lib/supabase/server'

// Tables with full pipeline implementation.
// TODO: Move a table name from TODO_TABLES to IMPLEMENTED_TABLES
//       and add its batchInsert call in app/api/sync/route.ts
//       as each new GTFS table is added.
const IMPLEMENTED_TABLES = ['stops', 'routes'] as const

// Placeholder cards shown for tables not yet implemented.
// TODO: Remove from this list as tables are implemented.
const TODO_TABLES = [
  'trips',
  'stop_times',
  'calendar',
  'calendar_dates',
  'shapes',
  'agency',
  'fare_attributes',
  'fare_rules',
  'frequencies',
  'transfers',
  'feed_info',
] as const

export default async function DataPage() {
  const supabase = createClient()

  const counts = await Promise.all(
    IMPLEMENTED_TABLES.map(async (table) => {
      const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
      return { table, count: count ?? 0 }
    })
  )

  const { data: lastSync } = await supabase
    .from('sync_runs')
    .select('created_at')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastSyncAt = lastSync
    ? new Date(lastSync.created_at).toLocaleString()
    : null

  return (
    <div>
      <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-6">
        Data Preview
      </h1>

      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        {counts.map(({ table, count }) => (
          <div
            key={table}
            className="bg-slate-900 rounded-lg p-6 border border-slate-800"
          >
            <div className="text-violet-400 text-xs font-medium uppercase tracking-wide mb-2">
              {table}
            </div>
            <div className="text-3xl font-bold text-white">
              {count.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              rows{lastSyncAt ? ` · last synced ${lastSyncAt}` : ''}
            </div>
          </div>
        ))}

        {TODO_TABLES.map((table) => (
          <div
            key={table}
            className="bg-slate-900 rounded-lg p-6 border border-dashed border-slate-700 opacity-40"
          >
            <div className="text-slate-600 text-xs font-medium uppercase tracking-wide mb-2">
              {table}
            </div>
            <div className="text-sm text-slate-600 font-mono">// TODO</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Manually verify**

```bash
npm run dev
```

1. Navigate to `/dashboard/data`.
2. Expected: cards for `stops` and `routes` with current row counts and last sync timestamp.
3. Expected: 11 dimmed placeholder cards for the TODO tables.
4. Run a sync, then refresh `/dashboard/data` — row counts should update.

Kill the server with `Ctrl+C`.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/data/page.tsx
git commit -m "feat: add data preview view with row counts and TODO table placeholders"
```

---

## Task 12: Final wiring, .gitignore, and manual test run

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Confirm .gitignore covers generated/sensitive paths**

Open `.gitignore` and verify these entries are present. Add any that are missing:

```
.env.local
.next/
node_modules/
.superpowers/
```

- [ ] **Step 2: Full manual test checklist**

```bash
npm run dev
```

Run through each scenario and confirm the expected result:

**Auth flow:**
- [ ] Visit `http://localhost:3000` → redirects to `/login`
- [ ] Enter wrong password → red error message appears
- [ ] Enter correct credentials → redirected to `/dashboard/sync`
- [ ] Click Sign out → redirected to `/login`
- [ ] Attempt to visit `/dashboard/sync` while logged out → redirected to `/login`

**Sync — ZIP upload:**
- [ ] Upload a valid GTFS ZIP → green pill with row counts, history row appears
- [ ] Upload a non-ZIP file (e.g. a `.txt` file) → red pill with error
- [ ] Upload a ZIP missing `stops.txt` → red pill: "stops.txt not found in ZIP"
- [ ] Click Run Sync with no file selected → red pill: "Please select a ZIP file"

**Sync — API URL:**
- [ ] Enter a valid GTFS ZIP download URL → green pill with row counts
- [ ] Enter a URL that returns 404 → red pill: "Fetch failed: 404 Not Found"
- [ ] Enter a URL that is not a valid ZIP → red pill with parse error
- [ ] Click Run Sync with empty URL → red pill: "Please enter a URL"

**History:**
- [ ] After each sync above, navigate to `/dashboard/history` → new row at top
- [ ] Successful syncs show green left border, row counts, email, timestamp
- [ ] Failed syncs show red left border, error message

**Data preview:**
- [ ] After a successful sync, `/dashboard/data` shows updated row counts
- [ ] `stops` and `routes` cards show correct numbers
- [ ] 11 dimmed TODO cards are visible

- [ ] **Step 3: Final commit**

```bash
git add .gitignore
git commit -m "feat: complete GTFS sync dashboard PoC"
```

---

## Manual Testing Notes

**Finding a public GTFS feed for testing:**
- TransLink (Vancouver): https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs
- MTA (New York): https://api.mta.info/
- Many agencies list their GTFS feed URL on https://transitfeeds.com or https://mobilitydata.org/feeds

**Verifying data in Supabase:**
After a sync, go to Supabase → **Table Editor** → `stops` or `routes` to confirm rows were inserted.

**Checking sync_runs:**
Supabase → **Table Editor** → `sync_runs` shows all recorded runs with full attribution data.
