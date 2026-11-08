-- =============================================================================
-- MyChainScore — Schéma Supabase (Bloc 1 + Admin)
-- À exécuter dans l'éditeur SQL de ton projet Supabase (dashboard > SQL Editor)
-- =============================================================================

-- ── 0. Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── 1. Enum rôle utilisateur ──────────────────────────────────────────────────
create type user_role as enum ('user', 'admin');

-- ── 2. Enum statut d'abonnement ───────────────────────────────────────────────
create type subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid'
);

-- ── 3. Table profiles ─────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        user_role not null default 'user',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Trigger updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Trigger : crée automatiquement un profil à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    -- Si l'email correspond à l'admin configuré dans les app_settings,
    -- il reçoit le rôle admin automatiquement
    case
      when new.email = current_setting('app.admin_email', true) then 'admin'::user_role
      else 'user'::user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 4. Table subscriptions ────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                      uuid primary key default uuid_generate_v4(),
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  status                  subscription_status not null default 'trialing',
  trial_end               timestamptz default (now() + interval '30 days'),
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists subscriptions_stripe_customer_idx on public.subscriptions(stripe_customer_id);

-- ── 5. Table webauthn_credentials ─────────────────────────────────────────────
create table if not exists public.webauthn_credentials (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  credential_id   text not null unique,
  public_key      text not null,
  counter         bigint not null default 0,
  device_name     text,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);

create index if not exists webauthn_credentials_user_id_idx on public.webauthn_credentials(user_id);

-- ── 6. Table webauthn_challenges ──────────────────────────────────────────────
create table if not exists public.webauthn_challenges (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles(id) on delete cascade,
  challenge   text not null,
  type        text not null check (type in ('registration', 'authentication')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists webauthn_challenges_expires_idx on public.webauthn_challenges(expires_at);

-- ── 7. Table activity_log (journal admin) ─────────────────────────────────────
create table if not exists public.activity_log (
  id          uuid primary key default uuid_generate_v4(),
  event_type  text not null, -- 'signup', 'login', 'subscription_change', 'admin_action', 'error'
  user_id     uuid references public.profiles(id) on delete set null,
  user_email  text,          -- dénormalisé pour requêtes admin rapides
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_created_idx on public.activity_log(created_at desc);
create index if not exists activity_log_event_type_idx on public.activity_log(event_type);
create index if not exists activity_log_user_id_idx on public.activity_log(user_id);

-- Nettoyage auto des logs > 90 jours (optionnel, à activer via pg_cron)
-- select cron.schedule('clean-old-logs', '0 3 * * *', $$
--   delete from activity_log where created_at < now() - interval '90 days';
-- $$);

-- ── 8. Row Level Security (RLS) ───────────────────────────────────────────────

-- profiles
alter table public.profiles enable row level security;

create policy "profiles: lecture propre" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: mise à jour propre" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.profiles where id = auth.uid()));

-- Admin voit et peut modifier tous les profils
create policy "profiles: admin lecture tout" on public.profiles
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "profiles: admin mise à jour tout" on public.profiles
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- subscriptions
alter table public.subscriptions enable row level security;

create policy "subscriptions: lecture propre" on public.subscriptions
  for select using (auth.uid() = user_id);

create policy "subscriptions: admin tout" on public.subscriptions
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- webauthn_credentials
alter table public.webauthn_credentials enable row level security;

create policy "webauthn_credentials: lecture propre" on public.webauthn_credentials
  for select using (auth.uid() = user_id);

create policy "webauthn_credentials: suppression propre" on public.webauthn_credentials
  for delete using (auth.uid() = user_id);

create policy "webauthn_credentials: admin tout" on public.webauthn_credentials
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- webauthn_challenges : service_role uniquement
alter table public.webauthn_challenges enable row level security;

-- activity_log : admin lecture, service_role écriture
alter table public.activity_log enable row level security;

create policy "activity_log: admin lecture" on public.activity_log
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ── 9. Fonctions utilitaires ──────────────────────────────────────────────────

-- Vérifie si un user a un accès actif
create or replace function public.has_active_subscription(user_uuid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = user_uuid
      and status in ('active', 'trialing')
      and (
        (status = 'trialing' and (trial_end is null or trial_end > now()))
        or
        (status = 'active' and (current_period_end is null or current_period_end > now()))
      )
  );
$$;

-- Vérifie si un user est admin
create or replace function public.is_admin(user_uuid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.profiles
    where id = user_uuid and role = 'admin'
  );
$$;

-- Statistiques dashboard admin (appelée via service_role)
create or replace function public.get_admin_stats()
returns json language plpgsql security definer as $$
declare
  result json;
begin
  select json_build_object(
    'total_users',    (select count(*) from public.profiles where role = 'user'),
    'trialing',       (select count(*) from public.subscriptions where status = 'trialing' and (trial_end is null or trial_end > now())),
    'active',         (select count(*) from public.subscriptions where status = 'active'),
    'canceled',       (select count(*) from public.subscriptions where status = 'canceled'),
    'mrr_estimate',   (select count(*) * 2 from public.subscriptions where status = 'active')
  ) into result;
  return result;
end;
$$;
