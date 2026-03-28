create table if not exists coach_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  detail text not null,
  source_type text not null default 'note',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_coach_knowledge_items_user_created_at
  on coach_knowledge_items(user_id, created_at desc);
