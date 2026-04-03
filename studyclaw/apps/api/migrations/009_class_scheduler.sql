create table if not exists class_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  class_name text not null,
  subject text,
  room_number text,
  teacher_name text,
  start_time time,
  end_time time,
  period text,
  days_of_week text[] not null default '{}'::text[],
  notes text,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(days_of_week) > 0),
  check (start_time is null or end_time is null or start_time < end_time)
);

create index if not exists idx_class_schedule_entries_user_days
  on class_schedule_entries(user_id, days_of_week, start_time, period);

create index if not exists idx_class_schedule_entries_subject_id
  on class_schedule_entries(subject_id);

create trigger trg_class_schedule_entries_updated_at
before update on class_schedule_entries
for each row execute function set_updated_at();
