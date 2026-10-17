create table if not exists public.kanban_columns (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  color text not null default '#a46b45', position integer not null unique,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tasks add column if not exists column_id uuid references public.kanban_columns(id) on delete set null;
alter table public.tasks add column if not exists progress integer not null default 1;
alter table public.tasks add column if not exists parent_task_id uuid references public.tasks(id) on delete set null;
alter table public.tasks add column if not exists is_carried_over boolean not null default false;
alter table public.tasks add column if not exists carried_over_from_week date;
alter table public.tasks add column if not exists sent_at timestamptz;
alter table public.tasks drop constraint if exists tasks_progress_check;
alter table public.tasks add constraint tasks_progress_check check (progress between 1 and 10);
create index if not exists tasks_column_idx on public.tasks(column_id);
create index if not exists tasks_parent_idx on public.tasks(parent_task_id);
alter table public.kanban_columns enable row level security;
revoke all on public.kanban_columns from anon, authenticated;
grant all on public.kanban_columns to service_role;
insert into public.kanban_columns (name, color, position)
values ('To Do', '#c98b55', 1), ('In Progress', '#a96a45', 2), ('Completed', '#758662', 3)
on conflict (name) do nothing;
update public.tasks t set column_id = c.id from public.kanban_columns c where t.column_id is null and t.status = c.name;
drop trigger if exists kanban_columns_updated_at on public.kanban_columns;
create trigger kanban_columns_updated_at before update on public.kanban_columns for each row execute function public.set_updated_at();
