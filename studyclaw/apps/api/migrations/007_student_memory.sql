create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid references subjects(id) on delete cascade,
  name text not null,
  mastery_score numeric(4,3) not null default 0.5,
  last_reviewed_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, course_id, name)
);
create index if not exists idx_topics_user_course on topics(user_id, course_id, updated_at desc);
create trigger trg_topics_updated_at before update on topics for each row execute function set_updated_at();

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid references subjects(id) on delete set null,
  title text not null,
  status text not null default 'pending',
  due_at timestamptz,
  completed_at timestamptz,
  source_reminder_id uuid unique references reminders(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assignments_user_due on assignments(user_id, due_at asc);
create index if not exists idx_assignments_user_status on assignments(user_id, status);
create trigger trg_assignments_updated_at before update on assignments for each row execute function set_updated_at();

create table if not exists study_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  source_type text,
  source_id text,
  course_id uuid references subjects(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  assignment_id uuid references assignments(id) on delete set null,
  score numeric(6,3),
  payload_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_study_events_user_time on study_events(user_id, occurred_at desc);
create index if not exists idx_study_events_user_type on study_events(user_id, event_type, occurred_at desc);

create table if not exists progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid references subjects(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  source_event_id uuid references study_events(id) on delete set null,
  snapshot_type text not null,
  metric_key text not null,
  metric_value numeric(8,3) not null,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_progress_snapshots_source_metric on progress_snapshots(source_event_id, metric_key) where source_event_id is not null;
create index if not exists idx_progress_snapshots_user_recent on progress_snapshots(user_id, created_at desc);

create table if not exists memory_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  summary_key text not null unique,
  summary_type text not null,
  course_id uuid references subjects(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  source_event_id uuid references study_events(id) on delete set null,
  summary text not null,
  importance smallint not null default 3,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_memory_summaries_user_recent on memory_summaries(user_id, updated_at desc);
create index if not exists idx_memory_summaries_user_importance on memory_summaries(user_id, importance desc, updated_at desc);
create trigger trg_memory_summaries_updated_at before update on memory_summaries for each row execute function set_updated_at();

create or replace view students as
select
  u.id as user_id,
  u.email,
  u.full_name,
  u.role,
  sp.school_name,
  sp.school_level,
  sp.grade_year,
  sp.major,
  sp.timezone,
  sp.learning_style,
  sp.onboarding_complete,
  u.created_at,
  u.updated_at
from users u
left join student_profiles sp on sp.user_id = u.id
where u.role = 'student';

create or replace view courses as
select
  s.id as course_id,
  s.user_id,
  s.name,
  s.teacher_name,
  s.color,
  s.created_at,
  s.updated_at
from subjects s;
