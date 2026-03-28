create table if not exists user_saved_model_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider_id text not null,
  provider_name text not null,
  service_base_url text not null,
  api_key text,
  model_name text not null,
  model_key text not null,
  max_context_window integer,
  max_output_tokens integer,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_id, model_name, service_base_url)
);

create trigger trg_user_saved_model_configs_updated_at
before update on user_saved_model_configs
for each row execute function set_updated_at();
