create table if not exists admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  target_user_id uuid references users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_events_created_at
  on admin_audit_events(created_at desc);

create index if not exists idx_admin_audit_events_actor_created_at
  on admin_audit_events(actor_user_id, created_at desc);

create index if not exists idx_admin_audit_events_target_created_at
  on admin_audit_events(target_user_id, created_at desc);
