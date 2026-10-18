# WeeklyFlow Handoff

## Current state

WeeklyFlow is a React/Vite frontend with an Express API and Supabase Postgres persistence. It is deployed as one Vercel project, with the API exposed through `api/index.ts`.

The current branch contains the task feedback and focused workspace update. The latest local commit is `c54e5d8`, but this handoff file is intentionally left uncommitted for the owner to commit.

## Main features

- Mentor and student authentication with cookie sessions.
- Dashboard with real task counts, weekly progress, urgent tasks, and weekly boards.
- Kanban board with movable tasks, progress from 1–10, locked historical weeks, and mentor column management.
- Calendar showing saved task and board events.
- Full Kanban history by week.
- Task carryover to the next week.
- Automatic polling so new tasks and updates appear without a manual refresh.
- Task details drawer with description, progress, due date, activity, and feedback.
- Threaded mentor/student task feedback with unread counts.
- Kanban filters for status, high priority, due soon, and overdue tasks.
- No sample task records or generated demo assignments.

## Database setup

For a new database, run:

1. `supabase/schema.sql`
2. `supabase/migrations/202610170001_weeklyflow_workspace.sql`
3. `supabase/migrations/202610180001_task_feedback.sql`

For an existing database, run the two migration files only. The feedback migration creates `task_feedback` and `feedback_reads`, enables RLS, and grants access only to the server-side `service_role`.

The application uses `SUPABASE_SECRET_KEY` only on the server. Never expose it as a `VITE_` variable or commit it.

## Local development

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

Useful checks:

```powershell
pnpm build
git diff --check
```

## Environment variables

Copy `.env.example` to `.env` and configure the Supabase URL, server secret key, session secret, client origin, timezone, and explicitly configured mentor/student account values. Keep `.env` untracked.

## Deployment

Vercel deploys from the `main` branch. The project uses the repository `vercel.json` routing rules to serve both the Vite frontend and Express API. After pushing a change, wait for the Vercel deployment to show **Ready**.

Production health check:

```text
https://personal-tracker-eight-nu.vercel.app/api/health
```

Expected response:

```json
{"ok":true,"database":"connected"}
```

## Known operational note

The Supabase management connector currently cannot access the project referenced by the local `SUPABASE_URL`, so the feedback migration must be run manually in that project’s Supabase SQL Editor if it has not already been applied.

## Ownership and next steps

- The owner should review the working tree and commit `HANDOFF.md` when ready.
- After applying the feedback migration, test mentor feedback, student replies, unread badges, drawer closing, filters, and historical-week restrictions in both local and production environments.
- Do not commit `.env` or any Supabase secret key.
