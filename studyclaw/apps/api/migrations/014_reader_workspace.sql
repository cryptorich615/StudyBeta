create table if not exists study_asset_reader_state (
  user_id uuid not null references users(id) on delete cascade,
  asset_id uuid not null references study_assets(id) on delete cascade,
  progress_percent numeric(5,2) not null default 0,
  last_position text,
  last_page integer,
  view_mode text not null default 'scroll',
  zoom_level numeric(6,2) not null default 1,
  font_size integer not null default 18,
  line_spacing numeric(4,2) not null default 1.6,
  reading_width integer not null default 720,
  theme text not null default 'paper',
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);
create index if not exists idx_reader_state_user_last_opened on study_asset_reader_state(user_id, last_opened_at desc);
create trigger trg_study_asset_reader_state_updated_at
before update on study_asset_reader_state
for each row execute function set_updated_at();

create table if not exists study_asset_annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  asset_id uuid not null references study_assets(id) on delete cascade,
  kind text not null check (kind in ('bookmark', 'note', 'highlight')),
  label text,
  snippet text,
  note text,
  location text,
  page_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_study_asset_annotations_user_asset on study_asset_annotations(user_id, asset_id, created_at desc);
create trigger trg_study_asset_annotations_updated_at
before update on study_asset_annotations
for each row execute function set_updated_at();
