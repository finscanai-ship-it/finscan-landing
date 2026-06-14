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
  updated_at          timestamptz not null default now()
);

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

-- universe free preview: top 3 visible to everyone, including anonymous visitors.
drop policy if exists free_preview on public.universe;
create policy free_preview on public.universe
  for select using (rank <= 3);

-- universe full access: active subscribers see the whole universe.
drop policy if exists paid_full on public.universe;
create policy paid_full on public.universe
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.subscription_active = true
    )
  );

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
