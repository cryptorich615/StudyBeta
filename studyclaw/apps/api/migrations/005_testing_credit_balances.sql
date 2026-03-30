alter table user_usage_profiles
  add column if not exists credits_total integer not null default 0 check (credits_total >= 0);

alter table user_usage_profiles
  add column if not exists credits_remaining integer not null default 0 check (credits_remaining >= 0);
