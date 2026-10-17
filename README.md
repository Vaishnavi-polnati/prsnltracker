# WeeklyFlow

WeeklyFlow is a private placement preparation tracker for one mentor and one student. It uses a React, TypeScript and Vite client, an Express API, and Supabase Postgres persistence.

## Requirements

- Node.js 20 or later and pnpm
- A Supabase project (the database is hosted by Supabase)

## Local setup

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
   If this is an existing WeeklyFlow database, also run [`supabase/migrations/202610170001_weeklyflow_workspace.sql`](supabase/migrations/202610170001_weeklyflow_workspace.sql). It adds global Kanban columns, task progress, and carryover lineage without deleting user-created records. Run [`supabase/cleanup-generated-data.sql`](supabase/cleanup-generated-data.sql) once only if an older database still contains generated revision assignments.
2. In Supabase **Integrations → Data API**, expose the `public` schema so the server-side Supabase client can reach its tables. The tables have RLS enabled, and `anon`/`authenticated` have no table grants; the Express server uses only a server-side secret key.
3. In **Settings → API Keys**, copy the Project URL and a **Secret key** (recommended). Never put that key in browser code or commit it. Legacy service-role keys are temporarily supported for existing Supabase projects.
4. Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, a unique `SESSION_SECRET` (at least 32 random bytes), mentor/student names, and distinct mentor/student emails and passwords (at least 12 characters each). Set `APP_TIMEZONE` for date handling.
5. Install dependencies with `pnpm install`.
6. Seed the two configured application accounts with `pnpm seed`. Seeding is idempotent and never overwrites an existing password.
7. Start the API and web client with `pnpm dev`.
8. Open `http://localhost:5173` and sign in with a seeded account.

Public account registration is intentionally unavailable. The seed command refuses to run without explicit environment configuration.

## Scripts

- `pnpm dev` — Vite and Express development servers
- `pnpm build` — frontend production bundle and backend TypeScript check
- `pnpm start` — API server
- `pnpm seed` — create the two configured initial accounts

## Deployment

Set the environment variables from `.env.example`, and deploy the API and static frontend. Set `CLIENT_ORIGIN` to the exact frontend origin. Use HTTPS in production so session cookies can use `Secure` and `SameSite=None`. Configure `APP_TIMEZONE` to the timezone used for date handling. Keep the Supabase secret key server-side; never put it in Vite-prefixed environment variables. The frontend build is in `dist/`; the API listens on `PORT`.

## Current feature coverage

The API persists users, weekly boards, tasks and activity, check-ins, study sessions, DSA problems, revision records, projects, retrospectives, and weekly reports in Supabase Postgres. It enforces mentor-only task/project creation, validates sensitive requests, hashes passwords, rate-limits login, and emits task updates over Socket.IO. Historical boards are retained and current-week board creation is idempotent.

The dashboard and weekly Kanban board are connected to saved records. The student can update task status, and the mentor can assign tasks. Weekly history is read from the saved Supabase boards and tasks; no demo assignments or automatic task generation are used.
