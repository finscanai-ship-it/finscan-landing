-- FinScan web app — Block 2 schema.
-- Run ONCE in Supabase → SQL Editor (paste all, Run). Safe to re-run.
--
-- Two tables:
--   profiles  — subscription state, one row per auth user (filled by Stripe webhook)
--   universe  — the scored stocks, refreshed nightly by the owner scan
-- RLS gates reads: everyone sees the top 3 (free preview); active subs see all.
-- Writes to `universe`/`profiles` come from the SECRET key (server side), which
-- bypasses RLS — so no write policies are needed here.

-- ── profiles: subscription state ─────────────────────────────────────────────
create table if not exists public.profiles (
  id                  uuid        primary key references auth.users(id) on delete cascade,
  email               text,
  subscription_active boolean     not null default false,
  subscription_plan   text,                       -- 'monthly' | 'yearly' | null
  stripe_customer_id  text,
  free_picks          text[]      not null default '{}',  -- up to 3 self-chosen tickers (free preview)
  updated_at          timestamptz not null default now()
);

-- Existing DBs (table already created): add the column + cap it at 3 picks.
alter table public.profiles
  add column if not exists free_picks text[] not null default '{}';
alter table public.profiles drop constraint if exists free_picks_max3;
alter table public.profiles
  add constraint free_picks_max3 check (coalesce(array_length(free_picks, 1), 0) <= 3);

-- ── universe: scored stocks (full replace each nightly run) ──────────────────
create table if not exists public.universe (
  symbol      text        primary key,
  rank        int         not null,
  name        text,
  score       numeric,
  verdict     text,                                -- Outperforming … Weak (brand verdicts)
  category    text,                                -- one of the 18 FinScan categories
  sector      text,
  last_price  numeric,
  market_cap  numeric,
  data        jsonb       not null default '{}',   -- full screener row (everything else)
  scanned_at  timestamptz not null default now()
);
create index if not exists universe_rank_idx  on public.universe (rank);
create index if not exists universe_score_idx on public.universe (score desc);

-- ── Row-Level Security ───────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.universe enable row level security;

-- profiles: a user can read only their own row.
drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles
  for select using (auth.uid() = id);

-- profiles: a user may UPDATE only their own free_picks — never subscription_active.
-- The column-level GRANT is what enforces this: even with the row policy below,
-- Postgres rejects any update that touches a column they weren't granted.
-- (The Stripe webhook uses the service_role key, which bypasses RLS + grants.)
revoke update on public.profiles from anon, authenticated;
grant update (free_picks) on public.profiles to authenticated;
drop policy if exists own_profile_update on public.profiles;
create policy own_profile_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- universe free preview:
--   • anonymous visitors        → the top 3 by rank (taster, no login)
--   • signed-in free users       → only the (≤3) tickers they picked themselves
drop policy if exists free_preview on public.universe;
create policy free_preview on public.universe
  for select using (
    (auth.uid() is null and rank <= 3)
    or symbol = any (coalesce(
         (select free_picks from public.profiles where id = auth.uid()), '{}'))
  );

-- universe full access: active subscribers see the whole universe.
drop policy if exists paid_full on public.universe;
create policy paid_full on public.universe
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.subscription_active = true
    )
  );

-- ── public catalog: lets signed-in free users browse & pick their 3 ──────────
-- Exposes ONLY symbol/name/category — never the score/verdict/metrics — so it is
-- safe to read without a subscription. Runs as the view owner (security_invoker
-- off) so it can list every ticker for search, while the valuable columns stay
-- behind universe's RLS.
create or replace view public.universe_catalog
  with (security_invoker = false) as
  select symbol, name, category from public.universe;
grant select on public.universe_catalog to anon, authenticated;

-- ── auto-create a profile row on signup ──────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
