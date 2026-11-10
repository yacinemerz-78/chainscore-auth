-- =============================================================================
-- Migration 002 — Multi-tenant Telegram + Table portfolios
-- À exécuter dans Supabase > SQL Editor
-- =============================================================================

-- ── 1. Nouvelles colonnes dans profiles ───────────────────────────────────────

alter table public.profiles
  add column if not exists telegram_chat_id      text        default null,
  add column if not exists telegram_linked_at    timestamptz default null,
  add column if not exists telegram_link_token   text        default null,
  add column if not exists telegram_token_expires timestamptz default null;

-- Index pour le cron (filtre rapide sur les users liés)
create index if not exists profiles_telegram_chat_id_idx
  on public.profiles(telegram_chat_id)
  where telegram_chat_id is not null;

-- Index pour la recherche de token par le webhook
create index if not exists profiles_telegram_link_token_idx
  on public.profiles(telegram_link_token)
  where telegram_link_token is not null;

-- ── 2. Table portfolios (Option B) ────────────────────────────────────────────

create table if not exists public.portfolios (
  id           uuid        primary key default uuid_generate_v4(),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  coin_id      text        not null,  -- ID CoinGecko (ex: "bitcoin", "ethereum")
  coin_symbol  text        not null,  -- Symbole affiché (ex: "BTC", "ETH")
  coin_name    text        not null,  -- Nom lisible (ex: "Bitcoin")
  qty          numeric     not null check (qty > 0),
  invested_eur numeric     not null check (invested_eur >= 0),
  added_at     timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Un utilisateur ne peut pas avoir deux entrées pour la même crypto
  unique (user_id, coin_id)
);

-- Trigger updated_at
create trigger portfolios_updated_at
  before update on public.portfolios
  for each row execute function public.set_updated_at();

create index if not exists portfolios_user_id_idx on public.portfolios(user_id);

-- ── 3. RLS sur portfolios — strict : auth.uid() = user_id ─────────────────────

alter table public.portfolios enable row level security;

create policy "portfolios: SELECT propre"
  on public.portfolios for select
  using (auth.uid() = user_id);

create policy "portfolios: INSERT propre"
  on public.portfolios for insert
  with check (auth.uid() = user_id);

create policy "portfolios: UPDATE propre"
  on public.portfolios for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "portfolios: DELETE propre"
  on public.portfolios for delete
  using (auth.uid() = user_id);

-- Admin voit tout (lecture seule depuis le dashboard admin)
create policy "portfolios: admin lecture"
  on public.portfolios for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ── 4. Nettoyage automatique des tokens expirés ───────────────────────────────
-- Fonction appelable via pg_cron ou depuis le webhook à chaque requête

create or replace function public.clean_expired_telegram_tokens()
returns void language sql security definer as $$
  update public.profiles
  set
    telegram_link_token    = null,
    telegram_token_expires = null
  where
    telegram_link_token    is not null
    and telegram_token_expires < now();
$$;
