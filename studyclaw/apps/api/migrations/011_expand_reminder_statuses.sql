do $$
begin
  if exists (select 1 from pg_type where typname = 'reminder_status') then
    alter type reminder_status add value if not exists 'pending';
    alter type reminder_status add value if not exists 'completed';
  end if;
end $$;
