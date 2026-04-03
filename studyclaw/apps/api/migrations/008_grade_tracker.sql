create table if not exists grade_course_settings (
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references subjects(id) on delete cascade,
  calculation_mode text not null default 'points',
  category_weights_json jsonb not null default '{}'::jsonb,
  final_exam_weight numeric(5,2),
  grading_scale_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id),
  check (final_exam_weight is null or (final_exam_weight >= 0 and final_exam_weight <= 100))
);
create index if not exists idx_grade_course_settings_user_id on grade_course_settings(user_id);
create trigger trg_grade_course_settings_updated_at before update on grade_course_settings for each row execute function set_updated_at();

create table if not exists grade_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references subjects(id) on delete cascade,
  title text not null,
  category text not null default 'assignment',
  points_earned numeric(8,2),
  points_possible numeric(8,2),
  percent numeric(6,3),
  weight numeric(6,2),
  occurred_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (points_earned is null or points_earned >= 0),
  check (points_possible is null or points_possible > 0),
  check (percent is null or (percent >= 0 and percent <= 100)),
  check (weight is null or (weight >= 0 and weight <= 100))
);
create index if not exists idx_grade_items_user_course on grade_items(user_id, course_id, occurred_on desc, created_at desc);
create trigger trg_grade_items_updated_at before update on grade_items for each row execute function set_updated_at();

create table if not exists wrong_answer_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid references subjects(id) on delete cascade,
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
);
create index if not exists idx_wrong_answer_reviews_user_course on wrong_answer_reviews(user_id, course_id, occurred_on desc, created_at desc);
create index if not exists idx_wrong_answer_reviews_tags on wrong_answer_reviews using gin(concept_tags);
create trigger trg_wrong_answer_reviews_updated_at before update on wrong_answer_reviews for each row execute function set_updated_at();
