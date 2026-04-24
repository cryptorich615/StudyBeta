import { db } from './db';

const statements = [
  `
    alter table users
      add column if not exists google_id text unique,
      add column if not exists role text not null default 'student'
  `,
  `
    alter table agent_profiles
      add column if not exists preset_key text,
      add column if not exists custom_instructions text,
      add column if not exists core_traits_version text not null default 'v1',
      add column if not exists last_reset_at timestamptz
  `,
  `
    alter table student_profiles
      add column if not exists major text
  `,
  `
    alter table student_profiles
      add column if not exists tier int default 1,
      add column if not exists messages_sent int default 0,
      add column if not exists window_start timestamptz default now()
  `,
  `
    create table if not exists agents (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null unique references users(id) on delete cascade,
      openclaw_agent_id text not null unique,
      name varchar(100) not null default 'My Study Agent',
      agent_type varchar(20) not null check (agent_type in ('custom', 'quick_start_1', 'quick_start_2')),
      config jsonb not null default '{}'::jsonb,
      status varchar(20) not null default 'active' check (status in ('active', 'disabled', 'reset_pending')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists user_google_tokens (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null unique references users(id) on delete cascade,
      google_subject text not null,
      google_email citext,
      access_token text not null,
      refresh_token text,
      scope text not null,
      token_type text not null default 'Bearer',
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists agent_actions (
      id uuid primary key default gen_random_uuid(),
      agent_id uuid not null references agents(id) on delete cascade,
      action_type varchar(50) not null,
      summary text not null,
      payload jsonb,
      created_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists admin_agents (
      id uuid primary key default gen_random_uuid(),
      owner_user_id uuid unique references users(id) on delete cascade,
      openclaw_agent_id text not null unique,
      config jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists grade_course_settings (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      course_id uuid not null references subjects(id) on delete cascade,
      calculation_mode text not null default 'points' check (calculation_mode in ('points', 'weighted')),
      category_weights_json jsonb not null default '{}'::jsonb,
      final_exam_weight numeric,
      grading_scale_json jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, course_id)
    )
  `,
  `
    create table if not exists studyclaw_events (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      title text not null,
      description text,
      start_time timestamptz not null,
      end_time timestamptz,
      event_type text not null default 'personal' check (event_type in ('class', 'assignment', 'exam', 'personal')),
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists studyclaw_files (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      name text not null,
      file_type text not null default 'note' check (file_type in ('doc', 'spreadsheet', 'note')),
      content text not null default '',
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
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
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists topics (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      course_id uuid references subjects(id) on delete set null,
      name text not null,
      mastery_score numeric,
      last_reviewed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, course_id, name)
    )
  `,
  `
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
    )
  `,
  `
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
      score numeric,
      payload_json jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists progress_snapshots (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      course_id uuid references subjects(id) on delete set null,
      source_event_id uuid references study_events(id) on delete set null,
      snapshot_type text not null,
      metric_key text not null,
      metric_value numeric,
      notes text,
      created_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists grade_items (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      course_id uuid not null references subjects(id) on delete cascade,
      title text not null,
      category text not null,
      points_earned numeric,
      points_possible numeric,
      percent numeric,
      weight numeric,
      occurred_on date,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists wrong_answer_reviews (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      course_id uuid references subjects(id) on delete set null,
      source_type text not null,
      source_title text not null,
      question_text text not null,
      student_answer text,
      correct_answer text not null,
      explanation text,
      concept_tags text[] not null default '{}'::text[],
      difficulty text,
      occurred_on date,
      teacher_notes text,
      attachment_refs_json jsonb not null default '[]'::jsonb,
      last_explanation_json jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists memory_summaries (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      summary_key text not null unique,
      summary_type text not null,
      course_id uuid references subjects(id) on delete set null,
      topic_id uuid references topics(id) on delete set null,
      source_event_id uuid references study_events(id) on delete set null,
      summary text not null,
      importance int not null default 3,
      last_used_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    create table if not exists admin_audit_events (
      id uuid primary key default gen_random_uuid(),
      actor_user_id uuid references users(id) on delete set null,
      target_user_id uuid references users(id) on delete set null,
      event_type text not null,
      entity_type text not null,
      entity_id text,
      summary text not null,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `,
  `
    alter table flashcard_sets
      add column if not exists metadata_json jsonb not null default '{}'::jsonb
  `,
  `
    alter table quizzes
      add column if not exists metadata_json jsonb not null default '{}'::jsonb
  `,
  `
    create index if not exists idx_agents_user_id on agents(user_id)
  `,
  `
    create index if not exists idx_agents_status on agents(status)
  `,
  `
    create index if not exists idx_user_google_tokens_user_id on user_google_tokens(user_id)
  `,
  `
    create index if not exists idx_agent_actions_agent_id on agent_actions(agent_id)
  `,
  `
    create index if not exists idx_agent_actions_created_at on agent_actions(created_at desc)
  `,
  `
    create index if not exists idx_grade_course_settings_user_id on grade_course_settings(user_id)
  `,
  `
    create index if not exists idx_grade_course_settings_course_id on grade_course_settings(course_id)
  `,
  `
    create index if not exists idx_studyclaw_events_user_id on studyclaw_events(user_id)
  `,
  `
    create index if not exists idx_studyclaw_events_start_time on studyclaw_events(start_time)
  `,
  `
    create index if not exists idx_studyclaw_files_user_id on studyclaw_files(user_id)
  `,
  `
    create index if not exists idx_studyclaw_files_type on studyclaw_files(file_type)
  `,
  `
    create index if not exists idx_class_schedule_entries_user_id on class_schedule_entries(user_id)
  `,
  `
    create index if not exists idx_class_schedule_entries_subject_id on class_schedule_entries(subject_id)
  `,
  `
    create index if not exists idx_topics_user_id on topics(user_id)
  `,
  `
    create index if not exists idx_topics_course_id on topics(course_id)
  `,
  `
    create index if not exists idx_assignments_user_id on assignments(user_id)
  `,
  `
    create index if not exists idx_assignments_course_id on assignments(course_id)
  `,
  `
    create index if not exists idx_progress_snapshots_user_id on progress_snapshots(user_id)
  `,
  `
    create index if not exists idx_grade_items_user_id on grade_items(user_id)
  `,
  `
    create index if not exists idx_grade_items_course_id on grade_items(course_id)
  `,
  `
    create index if not exists idx_wrong_answer_reviews_user_id on wrong_answer_reviews(user_id)
  `,
  `
    create index if not exists idx_wrong_answer_reviews_course_id on wrong_answer_reviews(course_id)
  `,
  `
    create index if not exists idx_study_events_user_id on study_events(user_id)
  `,
  `
    create index if not exists idx_study_events_event_type on study_events(event_type)
  `,
  `
    create index if not exists idx_memory_summaries_user_id on memory_summaries(user_id)
  `,
  `
    create index if not exists idx_memory_summaries_type on memory_summaries(summary_type)
  `,
  `
    create index if not exists idx_admin_audit_events_created_at on admin_audit_events(created_at desc)
  `,
  `
    create index if not exists idx_admin_audit_events_actor_user_id on admin_audit_events(actor_user_id)
  `,
  `
    create index if not exists idx_admin_audit_events_target_user_id on admin_audit_events(target_user_id)
  `,
  `
    do $$
    begin
      if not exists (select 1 from pg_trigger where tgname = 'trg_agents_updated_at') then
        create trigger trg_agents_updated_at before update on agents for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_user_google_tokens_updated_at') then
        create trigger trg_user_google_tokens_updated_at before update on user_google_tokens for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_admin_agents_updated_at') then
        create trigger trg_admin_agents_updated_at before update on admin_agents for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_grade_course_settings_updated_at') then
        create trigger trg_grade_course_settings_updated_at before update on grade_course_settings for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_studyclaw_events_updated_at') then
        create trigger trg_studyclaw_events_updated_at before update on studyclaw_events for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_studyclaw_files_updated_at') then
        create trigger trg_studyclaw_files_updated_at before update on studyclaw_files for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_class_schedule_entries_updated_at') then
        create trigger trg_class_schedule_entries_updated_at before update on class_schedule_entries for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_topics_updated_at') then
        create trigger trg_topics_updated_at before update on topics for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_assignments_updated_at') then
        create trigger trg_assignments_updated_at before update on assignments for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_grade_items_updated_at') then
        create trigger trg_grade_items_updated_at before update on grade_items for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_wrong_answer_reviews_updated_at') then
        create trigger trg_wrong_answer_reviews_updated_at before update on wrong_answer_reviews for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_memory_summaries_updated_at') then
        create trigger trg_memory_summaries_updated_at before update on memory_summaries for each row execute function set_updated_at();
      end if;
      if not exists (select 1 from pg_trigger where tgname = 'trg_admin_audit_events_updated_at') then
        create trigger trg_admin_audit_events_updated_at before update on admin_audit_events for each row execute function set_updated_at();
      end if;
    end $$;
  `,
];

let ensured = false;

export async function ensurePlatformSchema() {
  if (ensured) {
    return;
  }

  for (const statement of statements) {
    // STUDYCLAW-EXTENSION: keep startup additive until the project has first-class migrations.
    await db.query(statement);
  }

  ensured = true;
}
