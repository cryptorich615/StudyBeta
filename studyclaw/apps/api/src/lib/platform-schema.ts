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
