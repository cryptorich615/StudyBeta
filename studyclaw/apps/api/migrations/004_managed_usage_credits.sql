do $$
begin
  if not exists (select 1 from pg_type where typname = 'studyclaw_usage_tier') then
    create type studyclaw_usage_tier as enum ('tier_1', 'tier_2', 'tier_3');
  end if;

  if not exists (select 1 from pg_type where typname = 'studyclaw_billing_mode') then
    create type studyclaw_billing_mode as enum ('managed', 'byok', 'local', 'admin', 'unknown');
  end if;

  if not exists (select 1 from pg_type where typname = 'studyclaw_usage_event_status') then
    create type studyclaw_usage_event_status as enum ('reserved', 'consumed', 'failed');
  end if;
end $$;

create table if not exists user_usage_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  tier studyclaw_usage_tier not null default 'tier_1',
  billing_mode studyclaw_billing_mode not null default 'unknown',
  provider_selection text,
  model_selection text,
  uses_managed_credits boolean not null default false,
  credits_total integer not null default 0 check (credits_total >= 0),
  credits_remaining integer not null default 0 check (credits_remaining >= 0),
  managed_provider_id text,
  managed_model_key text,
  byok_provider_id text,
  internal_usage_identity text unique,
  identity_status text not null default 'unassigned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_usage_profiles_updated_at
before update on user_usage_profiles
for each row execute function set_updated_at();

create table if not exists managed_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  usage_identity text,
  provider_id text not null,
  model_key text not null,
  feature text not null,
  event_key text not null,
  status studyclaw_usage_event_status not null default 'reserved',
  request_units integer not null default 1 check (request_units > 0),
  metadata_json jsonb not null default '{}'::jsonb,
  reserved_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists idx_managed_usage_events_user_reserved_at
  on managed_usage_events(user_id, reserved_at desc);

create index if not exists idx_managed_usage_events_identity_reserved_at
  on managed_usage_events(usage_identity, reserved_at desc);

create index if not exists idx_managed_usage_events_status_reserved_at
  on managed_usage_events(status, reserved_at desc);

create trigger trg_managed_usage_events_updated_at
before update on managed_usage_events
for each row execute function set_updated_at();
