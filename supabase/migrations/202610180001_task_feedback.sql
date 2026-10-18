create table if not exists public.task_feedback (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.app_users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists task_feedback_task_created_idx
  on public.task_feedback(task_id, created_at asc);

create table if not exists public.feedback_reads (
  feedback_id uuid not null references public.task_feedback(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

create index if not exists feedback_reads_user_idx
  on public.feedback_reads(user_id, read_at desc);

alter table public.task_feedback enable row level security;
alter table public.feedback_reads enable row level security;

revoke all on public.task_feedback, public.feedback_reads from anon, authenticated;
grant all on public.task_feedback, public.feedback_reads to service_role;
