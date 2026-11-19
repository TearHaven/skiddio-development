alter table public.tasks
  add column if not exists end_date date;

update public.tasks
set end_date = task_date
where end_date is null;

alter table public.tasks
  alter column end_date set not null;

notify pgrst, 'reload schema';
