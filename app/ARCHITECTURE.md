# FinScan Web App — Architecture (Phase 1)

Lives in the **landing repo** (`getfinscan.com/app`), deployed by Netlify like the rest of
the site. No build step — plain HTML/CSS/JS + Supabase JS client via CDN.

## Why this stack
- **Same repo + static** → zero new deploy pipeline; push → Netlify → live (like the landing).
- **Supabase** → auth + Postgres + Row-Level Security in one. The browser talks to it
  directly; RLS enforces "only active subscribers see the scored universe" — so we don't
  need to build a read API.
- **Existing Railway Flask server (`server/`)** stays as the *write/secret* side: Stripe
  webhooks and (later) the Excel-export endpoint. It holds the secret keys; the static app
  never does.

## Data flow
```
Nightly scan (screener.py, scheduled)  ──writes──▶  Supabase table `universe`
                                                          │ (RLS: SELECT only if active sub)
Browser (getfinscan.com/app)  ──reads──▶  Supabase  ◀──reads─┘
        │  signs in via Supabase Auth (magic link / email)
        │
Stripe checkout ──webhook──▶ Railway Flask ──sets `profiles.subscription_active`──▶ Supabase
```

## Secrets boundary (CRITICAL — never break this)
| Key | Where it lives | Committed to repo? |
|---|---|---|
| Supabase **anon** key + project URL | `app/config.js` (static) | ✅ yes — public by design, RLS protects data |
| Supabase **service_role** key | Railway env vars only | ❌ NEVER |
| Stripe **secret** key / webhook secret | Railway env vars only | ❌ NEVER |

The anon key is *meant* to be in the browser. Security comes from **RLS policies**, not from
hiding the key. The service_role key bypasses RLS — it lives only on the server.

## Access model
- **Free tier:** anonymous or signed-in, no active sub → sees **3 stocks** (the "Try 3 free").
- **Paid:** `profiles.subscription_active = true` → RLS unlocks the full universe.
- The current license-key system stays for the CLI/Pro tier; web access is Supabase-based.

## Build blocks (this is Block 1)
- [x] **Block 1** — stack decision, scaffold, deploy pipeline (this commit)
- [x] **Block 2** — `universe` + `profiles` tables, RLS, owner push (`--push-supabase`)
- [ ] **Block 3** — Supabase Auth (login) + RLS gating
- [ ] **Block 4** — Stripe checkout → account → `subscription_active` (Railway webhook)
- [ ] **Block 5** — Dashboard: full-universe table + filters + KPI cards + charts
- [ ] **Block 6** — Excel/CSV export endpoint (reuse `_export_excel` on Railway)
- [ ] **Block 7** — Free-tier (3 stocks) + tests + polish

## Setup checklist for Tiago (do before Block 2)
1. Create a Supabase project at supabase.com (pick EU region — closest to Lisbon/customers).
2. Project Settings → API → copy the **Project URL** and the **anon public** key.
3. Paste both into `app/config.js` (replace the placeholders).
4. That's it for now — table schema + RLS come in Block 2.

> Reminder: paste ONLY the anon key into config.js. The service_role key never leaves
> Supabase/Railway.

## File map
```
landing/app/
  index.html        # dashboard shell (auth gate + table mount point)
  app.css           # app styles (reuses brand palette)
  app.js            # supabase init, connection test, auth/data stubs
  config.js         # SUPABASE_URL + anon (publishable) key — public, committed
  schema.sql        # Block 2: run once in Supabase SQL Editor (tables + RLS)
  ARCHITECTURE.md   # this file

../../supabase_sync.py   # Block 2: push_universe() — owner-only, reads SECRET key
../../screener.py        #   --push-supabase flag calls it after scoring
```

## Block 2 — how the data gets there
1. **Schema** — paste `app/schema.sql` into Supabase → SQL Editor → Run (once).
   Creates `universe` + `profiles`, RLS (top-3 free / full for active subs), and a
   signup trigger that auto-creates a profile row.
2. **Secret key** — Supabase → Settings → API → copy the **`sb_secret_...`** key into
   `finscan.cfg [supabase] service_role_key` (owner-local, never committed).
3. **Push** — run the scan with `--push-supabase`. It upserts every scored stock by
   symbol, then deletes rows older than this run (drops stocks that left the universe).
   Core columns (symbol/name/score/verdict/category/sector/price/mcap) are queryable;
   the full row lives in `data` jsonb for the Excel export and detail views.
