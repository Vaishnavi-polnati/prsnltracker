-- Run in the Supabase Dashboard SQL Editor for a new project.
-- The Express API is the only application database client. Its secret key is server-only.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('mentor', 'student')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_boards (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kanban_columns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#a46b45',
  position integer not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_records (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  track text not null check (track in ('AI', 'Java DSA')),
  checkpoint date not null,
  result text not null default 'Upcoming' check (result in ('Upcoming', 'Understood', 'Needs More Practice', 'Relearn')),
  feedback text,
  next_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic, checkpoint)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_date date,
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  category text not null default 'AI' check (category in ('AI', 'Java DSA', 'Project', 'Revision')),
  tags text[] not null default '{}',
  resources text[] not null default '{}',
  board_id uuid not null references public.weekly_boards(id) on delete restrict,
  revision_id uuid unique references public.revision_records(id) on delete set null,
  status text not null default 'To Do' check (status in ('To Do', 'In Progress', 'Completed')),
  column_id uuid references public.kanban_columns(id) on delete set null,
  progress integer not null default 1 check (progress between 1 and 10),
  parent_task_id uuid references public.tasks(id) on delete set null,
  is_carried_over boolean not null default false,
  carried_over_from_week date,
  sent_at timestamptz,
  review_status text not null default 'Not Submitted' check (review_status in ('Not Submitted', 'Submitted for Review', 'Changes Requested', 'Approved')),
  notes text,
  github_url text,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_board_status_idx on public.tasks(board_id, status);
create index if not exists tasks_category_idx on public.tasks(category);
create index if not exists tasks_due_date_idx on public.tasks(due_date);
create index if not exists tasks_column_idx on public.tasks(column_id);
create index if not exists tasks_parent_idx on public.tasks(parent_task_id);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  actor text not null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_task_created_idx on public.activity_logs(task_id, created_at desc);

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  note text,
  minutes integer not null default 0 check (minutes between 0 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  minutes integer not null check (minutes between 1 and 1440),
  track text not null check (track in ('AI', 'Java DSA', 'Project')),
  topic text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists study_sessions_date_idx on public.study_sessions(date desc);

create table if not exists public.dsa_problems (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  platform text,
  topic text,
  difficulty text not null default 'Medium' check (difficulty in ('Easy', 'Medium', 'Hard')),
  solution_url text,
  attempts integer not null default 0 check (attempts >= 0),
  independent boolean not null default false,
  notes text,
  status text not null default 'Not Started' check (status in ('Not Started', 'Practicing', 'Solved', 'Needs Revision')),
  last_solved timestamptz,
  next_revision date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  stack text[] not null default '{}',
  status text not null default 'Planning' check (status in ('Planning', 'Development', 'Testing', 'Deployed', 'Reviewed')),
  milestones jsonb not null default '[]'::jsonb,
  github_url text,
  live_url text,
  readme_done boolean not null default false,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_retrospectives (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null unique references public.weekly_boards(id) on delete restrict,
  achievements text,
  difficulties text,
  lessons text,
  next_priorities text,
  mentor_feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null unique references public.weekly_boards(id) on delete restrict,
  content text not null,
  source text not null default 'rule-based' check (source in ('rule-based', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Public Data API roles cannot access these records. Express performs authentication and authorization.
alter table public.app_users enable row level security;
alter table public.weekly_boards enable row level security;
alter table public.kanban_columns enable row level security;
alter table public.revision_records enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_logs enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.study_sessions enable row level security;
alter table public.dsa_problems enable row level security;
alter table public.projects enable row level security;
alter table public.weekly_retrospectives enable row level security;
alter table public.weekly_reports enable row level security;

revoke all on public.app_users, public.weekly_boards, public.revision_records, public.tasks,
  public.activity_logs, public.daily_checkins, public.study_sessions, public.dsa_problems,
  public.projects, public.weekly_retrospectives, public.weekly_reports, public.kanban_columns from anon, authenticated;
grant all on public.app_users, public.weekly_boards, public.revision_records, public.tasks,
  public.activity_logs, public.daily_checkins, public.study_sessions, public.dsa_problems,
  public.projects, public.weekly_retrospectives, public.weekly_reports, public.kanban_columns to service_role;

insert into public.kanban_columns (name, color, position)
values ('To Do', '#c98b55', 1), ('In Progress', '#a96a45', 2), ('Completed', '#758662', 3)
on conflict (name) do nothing;
update public.tasks t set column_id = c.id from public.kanban_columns c where t.column_id is null and c.name = t.status;

drop trigger if exists app_users_updated_at on public.app_users;
create trigger app_users_updated_at before update on public.app_users for each row execute function public.set_updated_at();
drop trigger if exists weekly_boards_updated_at on public.weekly_boards;
create trigger weekly_boards_updated_at before update on public.weekly_boards for each row execute function public.set_updated_at();
drop trigger if exists kanban_columns_updated_at on public.kanban_columns;
create trigger kanban_columns_updated_at before update on public.kanban_columns for each row execute function public.set_updated_at();
drop trigger if exists revision_records_updated_at on public.revision_records;
create trigger revision_records_updated_at before update on public.revision_records for each row execute function public.set_updated_at();
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists daily_checkins_updated_at on public.daily_checkins;
create trigger daily_checkins_updated_at before update on public.daily_checkins for each row execute function public.set_updated_at();
drop trigger if exists study_sessions_updated_at on public.study_sessions;
create trigger study_sessions_updated_at before update on public.study_sessions for each row execute function public.set_updated_at();
drop trigger if exists dsa_problems_updated_at on public.dsa_problems;
create trigger dsa_problems_updated_at before update on public.dsa_problems for each row execute function public.set_updated_at();
drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
drop trigger if exists weekly_retrospectives_updated_at on public.weekly_retrospectives;
create trigger weekly_retrospectives_updated_at before update on public.weekly_retrospectives for each row execute function public.set_updated_at();
drop trigger if exists weekly_reports_updated_at on public.weekly_reports;
create trigger weekly_reports_updated_at before update on public.weekly_reports for each row execute function public.set_updated_at();
