create table if not exists browser_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active',
  remote_url text not null,
  embed_url text,
  launch_url text not null,
  policy_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists idx_browser_sessions_user on browser_sessions(user_id, status);
