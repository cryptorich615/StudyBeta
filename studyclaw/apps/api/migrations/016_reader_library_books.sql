create table if not exists study_library_books (
  user_id uuid not null references users(id) on delete cascade,
  library_key text not null,
  payload_json jsonb not null default '{}'::jsonb,
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, library_key)
);
create index if not exists idx_study_library_books_user_last_opened
  on study_library_books(user_id, last_opened_at desc);
create trigger trg_study_library_books_updated_at
before update on study_library_books
for each row execute function set_updated_at();
