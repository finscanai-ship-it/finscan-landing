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
- **Anonymous (not signed in):** sees the **top 3 by rank** (a no-login taster).
- **Signed-in free:** picks **up to 3 stocks of their own choice** — stored in
  `profiles.free_picks`; RLS returns exactly those rows. The picker searches a
  public `universe_catalog` view (symbol/name/category only — no scores leak).
- **Paid:** `profiles.subscription_active = true` → RLS unlocks the full universe.
- The current license-key system stays for the CLI/Pro tier; web access is Supabase-based.

> Security: a free user can `UPDATE` only the `free_picks` column of their own row
> (enforced by a Postgres column-level `GRANT`, not just RLS) — they can never flip
> `subscription_active`. Only the service_role key (server/webhook) can.

## Build blocks (this is Block 1)
- [x] **Block 1** — stack decision, scaffold, deploy pipeline (this commit)
- [x] **Block 2** — `universe` + `profiles` tables, RLS, owner push (`--push-supabase`)
- [x] **Block 3** — magic-link auth + RLS-gated access state (free sees 3, sub sees all)
- [x] **Block 4** — Stripe checkout → `subscription_active` via Railway webhook
- [x] **Block 5** — Dashboard: KPI cards + filters + sortable universe table
- [x] **Block 6** — client-side CSV + XLSX export of the current filtered view
- [x] **Block 7** — welcome banner (webhook-race polling), empty state, mobile polish
- [x] **Block 8** — free tier = pick-your-own 3 (catalog view + `free_picks` + column grant)

**Phase 1 complete.** Remaining before public launch: fill the universe
(`screener.py --push-supabase`), end-to-end test the paid flow, then link `/app`
from the landing nav and drop the `noindex`.

> Block 8 migration: re-run `app/schema.sql` in Supabase → SQL Editor (it's
> idempotent — adds `free_picks`, the column grant, the new `free_preview` policy,
> and the `universe_catalog` view; leaves existing data untouched).

> Block 6 note: export is client-side (no server, no secrets) — it dumps the
> current filtered/sorted rows incl. the full `data` jsonb fields. The richly
> formatted Excel (charts, data bars) stays the CLI artifact; a server-side
> branded export can come later if customers ask for it.

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

## Block 3 — auth setup (one-time, in Supabase dashboard)
Magic-link login won't redirect correctly until the URLs are allow-listed:
1. Supabase → **Authentication → URL Configuration**:
   - **Site URL**: `https://getfinscan.com/app/`
   - **Redirect URLs** — add both: `https://getfinscan.com/app/` and (for local testing)
     the `file://…/landing/app/index.html` path or a localhost server URL.
2. Email auth is on by default. The built-in mailer is rate-limited (~few/hour) — fine
   for testing. For volume, wire **Resend SMTP** (already used for license emails) under
   Authentication → Emails → SMTP.
3. No password is ever entered — `signInWithOtp` sends a one-click link.

## Block 4 — Stripe checkout (web flow)
The browser never touches Stripe secrets. Flow:
```
[app] signed-in user clicks Upgrade
   → POST {API_BASE}/web/create-checkout  (Bearer = Supabase access token, {plan})
   → [Railway] verifies token via Supabase /auth/v1/user, creates a Checkout
     Session with client_reference_id = supabase_user_id, returns {url}
   → browser redirects to Stripe; user pays (EARLY10/partner codes allowed)
   → Stripe → [Railway] /webhook checkout.session.completed
       client_reference_id is a UUID ⇒ WEB flow ⇒ set profiles.subscription_active=true
       (NO licence key, NO zip email — that path is CLI-only)
   → user returns to /app?welcome=1, RLS now unlocks the full universe
```
Cancellation: `customer.subscription.deleted` → `subscription_active=false`
(mapped by `subscription.metadata.supabase_user_id`, fallback `stripe_customer_id`).

**Railway env vars to add** (Railway → Variables; values from `server/.env.example`):
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (sb_secret_…), `SUPABASE_ANON_KEY`
(sb_publishable_…), optionally `WEB_SUCCESS_URL` / `WEB_CANCEL_URL`.
Also add the **`customer.subscription.deleted`** event to the Stripe webhook.
