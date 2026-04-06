alter table reminders
  add column if not exists delivered boolean not null default false;

alter table reminders
  add column if not exists delivered_at timestamptz;

create index if not exists idx_reminders_due_delivery
  on reminders(delivered, status, reminder_at);
