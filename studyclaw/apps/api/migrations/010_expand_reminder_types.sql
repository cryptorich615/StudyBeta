do $$
begin
  if exists (select 1 from pg_type where typname = 'reminder_type') then
    alter type reminder_type add value if not exists 'quiz';
    alter type reminder_type add value if not exists 'test';
    alter type reminder_type add value if not exists 'project';
    alter type reminder_type add value if not exists 'paper';
    alter type reminder_type add value if not exists 'essay';
    alter type reminder_type add value if not exists 'lab';
    alter type reminder_type add value if not exists 'homework';
    alter type reminder_type add value if not exists 'participation';
  end if;
end $$;

