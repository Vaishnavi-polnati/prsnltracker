import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { z } from 'zod';
import { db, result, clientRow } from './db.js';

const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, { cors: { origin, credentials: true } });
const secret = process.env.SESSION_SECRET;
if (!secret && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required in production');
const key = secret || 'local-development-only-change-me';

app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

type Req = express.Request & { user?: { id: string; role: 'mentor' | 'student'; name: string } };
const dateInZone = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const weekStart = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const today = () => dateInZone();
function makeToken(payload: object) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 864e5 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', key).update(body).digest('base64url')}`;
}
function auth(req: Req, res: express.Response, next: express.NextFunction) {
  try {
    const [body, signature] = (req.cookies.session as string).split('.');
    const expected = crypto.createHmac('sha256', key).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('Invalid session');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) throw new Error('Expired session');
    req.user = { id: payload.id, role: payload.role, name: payload.name };
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in to continue.' });
  }
}
const mentor = (req: Req, res: express.Response, next: express.NextFunction) => req.user?.role === 'mentor'
  ? next() : res.status(403).json({ error: 'Mentor access required.' });
const validate = (schema: z.ZodTypeAny) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check the submitted fields.', details: parsed.error.flatten() });
  req.body = parsed.data;
  next();
};
const safe = (fn: (req: Req, res: express.Response) => Promise<unknown>) => (req: Req, res: express.Response, next: express.NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);
const row = (data: any) => data ? clientRow(data) : data;
const rows = (data: any[]) => (data || []).map(clientRow);
const uniqueConflict = (res: express.Response, error: any, message: string) => {
  if (error?.code === '23505') { res.status(409).json({ error: message }); return true; }
  return false;
};
const fallbackColumns = [
  { id: 'fallback-todo', name: 'To Do', color: '#c98b55', position: 1, is_active: true },
  { id: 'fallback-progress', name: 'In Progress', color: '#a96a45', position: 2, is_active: true },
  { id: 'fallback-completed', name: 'Completed', color: '#758662', position: 3, is_active: true },
];
let workspaceSchemaAvailable: boolean | null = null;
const fallbackProgress = new Map<string, number>();
async function hasWorkspaceSchema() {
  if (workspaceSchemaAvailable !== null) return workspaceSchemaAvailable;
  const { error } = await db.from('kanban_columns').select('id').limit(1);
  workspaceSchemaAvailable = !error;
  return workspaceSchemaAvailable;
}

app.get('/api/health', safe(async (_req, res) => {
  await result(db.from('weekly_boards').select('id').limit(1));
  res.json({ ok: true, database: 'connected' });
}));
app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false }), validate(z.object({ email: z.string().email(), password: z.string().min(1) })), safe(async (req, res) => {
  const user = await result<any>(db.from('app_users').select('*').eq('email', req.body.email.toLowerCase()).maybeSingle());
  if (!user || !await bcrypt.compare(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.cookie('session', makeToken({ id: user.id, role: user.role, name: user.name }), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 7 * 864e5,
  });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('session'); res.json({ ok: true }); });
app.get('/api/auth/me', auth, (req: Req, res) => res.json({ user: req.user }));
app.use('/api', auth);

app.get('/api/boards', safe(async (_req, res) => {
  const data = await result<any[]>(db.from('weekly_boards').select('*').order('week_start', { ascending: false }));
  res.json(rows(data));
}));
app.post('/api/boards', mentor, validate(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().min(1).max(100).optional() })), safe(async (req, res) => {
  const data = await result<any>(db.from('weekly_boards').upsert({ week_start: req.body.weekStart, label: req.body.label || `Week of ${req.body.weekStart}` }, { onConflict: 'week_start' }).select().single());
  res.status(201).json(row(data));
}));
app.patch('/api/boards/:id', mentor, validate(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), label: z.string().min(1).max(100).optional() })), safe(async (req, res) => {
  const update: Record<string, string> = {}; if (req.body.weekStart) update.week_start = req.body.weekStart; if (req.body.label) update.label = req.body.label;
  res.json(row(await result<any>(db.from('weekly_boards').update(update).eq('id', req.params.id).select().single())));
}));
app.delete('/api/boards/:id', mentor, safe(async (req, res) => {
  const count = await result<any[]>(db.from('tasks').select('id').eq('board_id', req.params.id).limit(1));
  if (count.length) return res.status(409).json({ error: 'Move or remove this week’s tasks before deleting the week.' });
  await result(db.from('weekly_boards').delete().eq('id', req.params.id)); res.json({ ok: true });
}));
app.get('/api/boards/current', safe(async (_req, res) => {
  const start = weekStart(today());
  const data = await result<any>(db.from('weekly_boards').upsert({ week_start: start, label: `Week of ${start}` }, { onConflict: 'week_start', ignoreDuplicates: true }).select().maybeSingle());
  if (data) return res.json(row(data));
  const existing = await result<any>(db.from('weekly_boards').select('*').eq('week_start', start).single());
  res.json(row(existing));
}));
app.post('/api/boards/:id/save', safe(async (req, res) => {
  const data = await result<any>(db.from('weekly_boards').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single());
  res.json(row(data));
}));
app.get('/api/boards/:id', safe(async (req, res) => {
  const data = await result<any>(db.from('weekly_boards').select('*').eq('id', req.params.id).maybeSingle());
  if (!data) return res.status(404).json({ error: 'Week not found.' });
  res.json(row(data));
}));
app.get('/api/kanban-columns', safe(async (req, res) => {
  if (!await hasWorkspaceSchema()) return res.json(fallbackColumns.filter(c => String(req.query.includeArchived) === 'true' || c.is_active).map(clientRow));
  const query = db.from('kanban_columns').select('*').order('position', { ascending: true });
  if (String(req.query.includeArchived) !== 'true') query.eq('is_active', true);
  res.json(rows(await result<any[]>(query)));
}));
app.post('/api/kanban-columns', mentor, validate(z.object({ name: z.string().min(1).max(60), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), position: z.number().int().positive().optional() })), safe(async (req, res) => {
  if (!await hasWorkspaceSchema()) { const position = req.body.position || fallbackColumns.length + 1; const item = { id: `fallback-${Date.now()}`, name: req.body.name, color: req.body.color || '#a46b45', position, is_active: true }; fallbackColumns.push(item); return res.status(201).json(clientRow(item)); }
  const active = await result<any[]>(db.from('kanban_columns').select('position').eq('is_active', true).order('position', { ascending: false }).limit(1));
  const position = req.body.position || ((active[0]?.position || 0) + 1);
  const data = await result<any>(db.from('kanban_columns').insert({ name: req.body.name, color: req.body.color || '#a46b45', position }).select().single());
  res.status(201).json(row(data));
}));
app.patch('/api/kanban-columns/:id', mentor, validate(z.object({ name: z.string().min(1).max(60).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), position: z.number().int().positive().optional(), isActive: z.boolean().optional() })), safe(async (req, res) => {
  if (!await hasWorkspaceSchema()) { const item = fallbackColumns.find(c => c.id === req.params.id); if (!item) return res.status(404).json({ error: 'Column not found.' }); Object.assign(item, req.body, req.body.isActive === undefined ? {} : { is_active: req.body.isActive }); return res.json(clientRow(item)); }
  const update = Object.fromEntries(Object.entries(req.body).map(([key, value]) => [key === 'isActive' ? 'is_active' : key, value]));
  res.json(row(await result<any>(db.from('kanban_columns').update(update).eq('id', req.params.id).select().single())));
}));
app.post('/api/kanban-columns/reorder', mentor, validate(z.object({ ids: z.array(z.string()).min(1) })), safe(async (req, res) => {
  if (!await hasWorkspaceSchema()) { req.body.ids.forEach((id: string, index: number) => { const c = fallbackColumns.find(item => item.id === id); if (c) c.position = index + 1; }); return res.json(fallbackColumns.sort((a, b) => a.position - b.position).map(clientRow)); }
  for (const [index, id] of req.body.ids.entries()) await result(db.from('kanban_columns').update({ position: index + 1 }).eq('id', id));
  res.json(rows(await result<any[]>(db.from('kanban_columns').select('*').order('position'))));
}));
app.post('/api/kanban-columns/:id/archive', mentor, safe(async (req, res) => { if (!await hasWorkspaceSchema()) { const c = fallbackColumns.find(item => item.id === req.params.id); if (!c) return res.status(404).json({ error: 'Column not found.' }); c.is_active = false; return res.json(clientRow(c)); } res.json(row(await result<any>(db.from('kanban_columns').update({ is_active: false }).eq('id', req.params.id).select().single()))); }));
app.post('/api/kanban-columns/:id/restore', mentor, safe(async (req, res) => { if (!await hasWorkspaceSchema()) { const c = fallbackColumns.find(item => item.id === req.params.id); if (!c) return res.status(404).json({ error: 'Column not found.' }); c.is_active = true; return res.json(clientRow(c)); } res.json(row(await result<any>(db.from('kanban_columns').update({ is_active: true }).eq('id', req.params.id).select().single()))); }));
app.get('/api/tasks', safe(async (req, res) => {
  let query = db.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
  if (req.query.board) query = query.eq('board_id', req.query.board as string);
  if (req.query.category) query = query.eq('category', req.query.category as string);
  if (req.query.search) query = query.ilike('title', `%${String(req.query.search).replace(/[%_]/g, '')}%`);
  if (req.user?.role === 'student') query = query.or('sent_at.not.is.null,is_carried_over.eq.false');
  const tasks = await result<any[]>(query);
  const boardIds = [...new Set(tasks.map(t => t.board_id))];
  const boards = boardIds.length ? await result<any[]>(db.from('weekly_boards').select('*').in('id', boardIds)) : [];
  const boardById = new Map(boards.map(b => [b.id, row(b)]));
  const columnIds = [...new Set(tasks.map(t => t.column_id).filter(Boolean))];
  const columnsData = await hasWorkspaceSchema() && columnIds.length ? await result<any[]>(db.from('kanban_columns').select('*').in('id', columnIds)) : fallbackColumns;
  const columnById = new Map(columnsData.map(c => [c.id, row(c)]));
  res.json(tasks.map(t => ({ ...row(t), progress: t.progress || fallbackProgress.get(t.id) || 1, board: boardById.get(t.board_id) || t.board_id, column: columnById.get(t.column_id) || null })));
}));
app.post('/api/tasks', mentor, validate(z.object({ title: z.string().min(1).max(180), description: z.string().optional(), dueDate: z.string().optional(), priority: z.enum(['Low', 'Medium', 'High']).optional(), category: z.enum(['AI', 'Java DSA', 'Project', 'Revision']).optional(), board: z.string().uuid(), columnId: z.string().optional(), tags: z.array(z.string()).optional(), resources: z.array(z.string()).optional() })), safe(async (req: Req, res) => {
  const duplicate = await result<any>(db.from('tasks').select('*').eq('board_id', req.body.board).eq('title', req.body.title).maybeSingle());
  if (duplicate) return res.json(row(duplicate));
  const base = { title: req.body.title, description: req.body.description, due_date: req.body.dueDate || null, priority: req.body.priority || 'Medium', category: req.body.category || 'Project', board_id: req.body.board, status: 'To Do', tags: req.body.tags || [], resources: req.body.resources || [], created_by: req.user!.id };
  const modern = await hasWorkspaceSchema();
  const first = modern ? await result<any>(db.from('kanban_columns').select('id').eq('is_active', true).order('position').limit(1).single()) : null;
  const insertPayload: any = modern ? { ...base, column_id: req.body.columnId || first.id, progress: 1, sent_at: new Date().toISOString() } : base;
  const data = await result<any>(db.from('tasks').insert(insertPayload).select().single());
  await result(db.from('activity_logs').insert({ task_id: data.id, actor: req.user!.name, action: 'created', detail: data.title }));
  io.emit('task:update', row(data));
  res.status(201).json(row(data));
}));
app.patch('/api/tasks/:id', safe(async (req: Req, res) => {
  const schema = z.object({ title: z.string().min(1).optional(), description: z.string().optional(), status: z.enum(['To Do', 'In Progress', 'Completed']).optional(), columnId: z.string().optional(), progress: z.number().int().min(1).max(10).optional(), reviewStatus: z.enum(['Not Submitted', 'Submitted for Review', 'Changes Requested', 'Approved']).optional(), priority: z.enum(['Low', 'Medium', 'High']).optional(), category: z.enum(['AI', 'Java DSA', 'Project', 'Revision']).optional(), dueDate: z.string().optional(), notes: z.string().optional(), githubUrl: z.string().url().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid task update.' });
  if (req.user!.role !== 'mentor' && Object.keys(parsed.data).some(k => !['status', 'columnId', 'progress', 'reviewStatus', 'notes', 'githubUrl'].includes(k))) return res.status(403).json({ error: 'Only mentors can edit assignment details.' });
  if (req.user!.role === 'student' && parsed.data.reviewStatus && parsed.data.reviewStatus !== 'Submitted for Review') return res.status(403).json({ error: 'Only mentors can approve work or request changes.' });
  const existing = await result<any>(db.from('tasks').select('*, weekly_boards(week_start)').eq('id', req.params.id).maybeSingle());
  if (!existing) return res.status(404).json({ error: 'Task not found.' });
  if (existing.weekly_boards?.week_start < weekStart(today())) return res.status(409).json({ error: 'Historical weekly boards are read-only.' });
  if (req.user!.role === 'student' && parsed.data.reviewStatus === 'Submitted for Review' && existing.status !== 'Completed') return res.status(409).json({ error: 'Complete the task before submitting it for review.' });
  const columns: Record<string, string> = { reviewStatus: 'review_status', dueDate: 'due_date', githubUrl: 'github_url', columnId: 'column_id' };
  const update = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [columns[k] || k, v]));
  const modern = await hasWorkspaceSchema();
  if (parsed.data.status && !parsed.data.columnId && modern) { const statusColumn = await result<any>(db.from('kanban_columns').select('id').eq('name', parsed.data.status).maybeSingle()); if (statusColumn) update.column_id = statusColumn.id; }
  if (parsed.data.columnId && modern) { const c = await result<any>(db.from('kanban_columns').select('is_active').eq('id', parsed.data.columnId).single()); if (!c.is_active && req.user!.role === 'student') return res.status(409).json({ error: 'Archived columns cannot receive tasks.' }); }
  if (!modern) { delete update.column_id; if (parsed.data.progress !== undefined) fallbackProgress.set(String(req.params.id), parsed.data.progress); delete update.progress; }
  const data = await result<any>(db.from('tasks').update(update).eq('id', req.params.id).select().single());
  await result(db.from('activity_logs').insert({ task_id: data.id, actor: req.user!.name, action: 'updated', detail: Object.keys(parsed.data).join(', ') }));
  io.emit('task:update', row(data));
  res.json(row(data));
}));
app.delete('/api/tasks/:id', mentor, safe(async (req, res) => {
  const task = await result<any>(db.from('tasks').select('*, weekly_boards(week_start)').eq('id', req.params.id).maybeSingle());
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (task.weekly_boards?.week_start < weekStart(today())) return res.status(409).json({ error: 'Historical weekly boards are read-only.' });
  await result(db.from('tasks').delete().eq('id', req.params.id));
  res.json({ ok: true });
}));
app.get('/api/tasks/:id/activity', safe(async (req, res) => {
  res.json(rows(await result<any[]>(db.from('activity_logs').select('*').eq('task_id', req.params.id).order('created_at', { ascending: false }))));
}));
app.post('/api/tasks/:id/carryover', mentor, safe(async (req: Req, res) => {
  const source = await result<any>(db.from('tasks').select('*, weekly_boards(week_start)').eq('id', req.params.id).single());
  if (!source) return res.status(404).json({ error: 'Task not found.' });
  const next = new Date(`${source.weekly_boards.week_start}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 7); const nextStart = next.toISOString().slice(0, 10);
  const board = await result<any>(db.from('weekly_boards').upsert({ week_start: nextStart, label: `Week of ${nextStart}` }, { onConflict: 'week_start' }).select().single());
  const first = await result<any>(db.from('kanban_columns').select('id').eq('is_active', true).order('position').limit(1).single());
  const copy = await result<any>(db.from('tasks').insert({ title: source.title, description: source.description, due_date: source.due_date, priority: source.priority, category: source.category, tags: source.tags, resources: source.resources, board_id: board.id, column_id: first.id, status: 'To Do', progress: 1, parent_task_id: source.id, is_carried_over: true, carried_over_from_week: source.weekly_boards.week_start, created_by: req.user!.id, sent_at: null }).select().single());
  await result(db.from('activity_logs').insert({ task_id: copy.id, actor: req.user!.name, action: 'carried_over', detail: `Copied from ${source.id}` })); res.status(201).json(row(copy));
}));
app.post('/api/tasks/:id/send', mentor, safe(async (req: Req, res) => { const data = await result<any>(db.from('tasks').update({ sent_at: new Date().toISOString() }).eq('id', req.params.id).select().single()); await result(db.from('activity_logs').insert({ task_id: data.id, actor: req.user!.name, action: 'sent', detail: 'Assignment sent' })); res.json(row(data)); }));
app.get('/api/tasks/:id/lineage', safe(async (req, res) => {
  const task = await result<any>(db.from('tasks').select('*').eq('id', req.params.id).single()); if (!task) return res.status(404).json({ error: 'Task not found.' });
  const children = await result<any[]>(db.from('tasks').select('*').eq('parent_task_id', task.id)); let parent = null; if (task.parent_task_id) parent = await result<any>(db.from('tasks').select('*').eq('id', task.parent_task_id).maybeSingle()); res.json({ task: row(task), parent: row(parent), children: rows(children) });
}));

app.get('/api/dashboard', safe(async (_req, res) => {
  const [tasks, checks, sessions, problems, projects] = await Promise.all([
    result<any[]>(db.from('tasks').select('*')), result<any[]>(db.from('daily_checkins').select('*').order('date', { ascending: false }).limit(400)),
    result<any[]>(db.from('study_sessions').select('*')), result<any[]>(db.from('dsa_problems').select('*')), result<any[]>(db.from('projects').select('*')),
  ]);
  const completed = tasks.filter(t => t.status === 'Completed').length;
  const dates = new Set(checks.map(c => c.date));
  let streak = 0; let cursor = today();
  if (!dates.has(cursor)) { const d = new Date(`${cursor}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); cursor = d.toISOString().slice(0, 10); }
  while (dates.has(cursor)) { streak++; const d = new Date(`${cursor}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); cursor = d.toISOString().slice(0, 10); }
  const now = new Date(); const soon = new Date(now.getTime() + 48 * 3600000); const due = (t: any) => t.due_date && new Date(`${t.due_date}T23:59:59`) <= soon && t.status !== 'Completed';
  const boardRows = await result<any[]>(db.from('weekly_boards').select('id,week_start').order('week_start'));
  const weekly = boardRows.map((b, i) => { const own = tasks.filter(t => t.board_id === b.id); return { number: i + 1, boardId: b.id, total: own.length, completed: own.filter(t => t.status === 'Completed').length }; });
  res.json({ total: tasks.length, completed, active: tasks.filter(t => t.status !== 'Completed').length, overdue: tasks.filter(t => t.due_date && t.due_date < today() && t.status !== 'Completed').length, carriedOver: tasks.filter(t => t.is_carried_over).length, urgent: tasks.filter(due), rate: tasks.length ? Math.round(completed / tasks.length * 100) : 0, weekly, ai: tasks.filter(t => t.category === 'AI').length, dsa: tasks.filter(t => t.category === 'Java DSA').length, aiCompleted: tasks.filter(t => t.category === 'AI' && t.status === 'Completed').length, dsaCompleted: tasks.filter(t => t.category === 'Java DSA' && t.status === 'Completed').length, streak, studyMinutes: sessions.reduce((a, s) => a + s.minutes, 0), solved: problems.filter(p => p.status === 'Solved').length, projects: projects.length, checks: checks.map(c => ({ date: c.date, minutes: c.minutes })), todayTasks: tasks.filter(t => t.due_date === today()) });
}));
app.get('/api/calendar', safe(async (req, res) => {
  const from = String(req.query.from || '2000-01-01'); const to = String(req.query.to || '2100-01-01');
  const [tasks, checks, sessions, boards] = await Promise.all([result<any[]>(db.from('tasks').select('*').gte('due_date', from).lte('due_date', to)), result<any[]>(db.from('daily_checkins').select('*').gte('date', from).lte('date', to)), result<any[]>(db.from('study_sessions').select('*').gte('date', from).lte('date', to)), result<any[]>(db.from('weekly_boards').select('*').gte('week_start', from).lte('week_start', to))]);
  res.json([...tasks.map(t => ({ id: t.id, kind: 'task', date: t.due_date, title: t.title, status: t.status, overdue: t.due_date < today() && t.status !== 'Completed', taskId: t.id })), ...checks.map(c => ({ id: c.id, kind: 'checkin', date: c.date, title: 'Daily check-in' })), ...sessions.map(s => ({ id: s.id, kind: 'study', date: s.date, title: s.topic || 'Study session' })), ...boards.map(b => ({ id: b.id, kind: 'week', date: b.week_start, title: b.label }))]);
}));
app.get('/api/checkins', safe(async (_req, res) => {
  res.json(rows(await result<any[]>(db.from('daily_checkins').select('*').order('date', { ascending: false }).limit(400))));
}));
app.post('/api/checkins', validate(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().optional(), minutes: z.number().min(0).max(1440).default(0) })), safe(async (req, res) => {
  try { const data = await result<any>(db.from('daily_checkins').insert({ ...req.body, date: req.body.date }).select().single()); res.status(201).json(row(data)); }
  catch (e: any) { if (uniqueConflict(res, e, 'Today is already checked in.')) return; throw e; }
}));
app.get('/api/study-sessions', safe(async (_req, res) => {
  res.json(rows(await result<any[]>(db.from('study_sessions').select('*').order('date', { ascending: false }))));
}));
app.post('/api/study-sessions', validate(z.object({ date: z.string(), minutes: z.number().min(1).max(1440), track: z.enum(['AI', 'Java DSA', 'Project']), topic: z.string().optional(), notes: z.string().optional() })), safe(async (req, res) => res.status(201).json(row(await result<any>(db.from('study_sessions').insert(req.body).select().single())))));
app.get('/api/dsa', safe(async (_req, res) => {
  res.json(rows(await result<any[]>(db.from('dsa_problems').select('*').order('updated_at', { ascending: false }))));
}));
app.post('/api/dsa', validate(z.object({ title: z.string().min(1), platform: z.string().optional(), topic: z.string().optional(), difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(), solutionUrl: z.string().optional() })), safe(async (req, res) => res.status(201).json(row(await result<any>(db.from('dsa_problems').insert({ title: req.body.title, platform: req.body.platform, topic: req.body.topic, difficulty: req.body.difficulty || 'Medium', solution_url: req.body.solutionUrl }).select().single())))));
app.patch('/api/dsa/:id', safe(async (req, res) => {
  const update = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [k === 'lastSolved' ? 'last_solved' : k === 'nextRevision' ? 'next_revision' : k, v]));
  res.json(row(await result<any>(db.from('dsa_problems').update(update).eq('id', req.params.id).select().single())));
}));

app.get('/api/revisions', safe(async (_req, res) => { res.json(rows(await result<any[]>(db.from('revision_records').select('*').order('checkpoint', { ascending: true })))); }));
app.post('/api/revisions/generate', mentor, (_req, res) => res.status(410).json({ error: 'Automatic revision generation is unavailable. Create real assignments from the current week.' }));
app.patch('/api/revisions/:id', safe(async (req, res) => {
  const update = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [k === 'nextDate' ? 'next_date' : k, v]));
  res.json(row(await result<any>(db.from('revision_records').update(update).eq('id', req.params.id).select().single())));
}));

app.get('/api/projects', safe(async (_req, res) => {
  res.json(rows(await result<any[]>(db.from('projects').select('*').order('updated_at', { ascending: false }))));
}));
app.post('/api/projects', mentor, validate(z.object({ name: z.string().min(1), description: z.string().optional(), stack: z.array(z.string()).optional(), githubUrl: z.string().optional() })), safe(async (req, res) => res.status(201).json(row(await result<any>(db.from('projects').insert({ ...req.body, github_url: req.body.githubUrl }).select().single())))));
app.patch('/api/projects/:id', safe(async (req: Req, res) => {
  if (req.user!.role !== 'mentor' && ('feedback' in req.body || 'status' in req.body)) return res.status(403).json({ error: 'Mentor access required.' });
  const map: Record<string, string> = { githubUrl: 'github_url', liveUrl: 'live_url', readmeDone: 'readme_done' };
  res.json(row(await result<any>(db.from('projects').update(Object.fromEntries(Object.entries(req.body).map(([k, v]) => [map[k] || k, v]))).eq('id', req.params.id).select().single())));
}));

app.get('/api/retrospectives/:board', safe(async (req, res) => {
  res.json(row(await result<any>(db.from('weekly_retrospectives').select('*').eq('board_id', req.params.board).maybeSingle())));
}));
app.put('/api/retrospectives/:board', safe(async (req: Req, res) => {
  const allowed = req.user!.role === 'mentor' ? ['mentorFeedback'] : ['achievements', 'difficulties', 'lessons', 'nextPriorities'];
  const snake: Record<string, string> = { mentorFeedback: 'mentor_feedback', nextPriorities: 'next_priorities' };
  const fields = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)).map(([k, v]) => [snake[k] || k, v]));
  res.json(row(await result<any>(db.from('weekly_retrospectives').upsert({ board_id: req.params.board, ...fields }, { onConflict: 'board_id' }).select().single())));
}));
app.get('/api/reports/:board', safe(async (req, res) => {
  res.json(row(await result<any>(db.from('weekly_reports').select('*').eq('board_id', req.params.board).maybeSingle())));
}));
app.post('/api/reports/:board', safe(async (req, res) => {
  const [board, tasks, sessions, problems, revisions, retro] = await Promise.all([
    result<any>(db.from('weekly_boards').select('*').eq('id', req.params.board).maybeSingle()), result<any[]>(db.from('tasks').select('*').eq('board_id', req.params.board)),
    result<any[]>(db.from('study_sessions').select('*')), result<any[]>(db.from('dsa_problems').select('*')), result<any[]>(db.from('revision_records').select('*')),
    result<any>(db.from('weekly_retrospectives').select('*').eq('board_id', req.params.board).maybeSingle()),
  ]);
  if (!board) return res.status(404).json({ error: 'Week not found.' });
  const completed = tasks.filter(t => t.status === 'Completed'); const pending = tasks.filter(t => t.status !== 'Completed');
  const overdue = pending.filter(t => t.due_date && t.due_date < today()); const minutes = sessions.filter(s => s.date >= board.week_start).reduce((a, s) => a + s.minutes, 0);
  const repeated = revisions.filter(r => ['Needs More Practice', 'Relearn'].includes(r.result));
  const content = `Week of ${board.week_start}\n\nProgress: ${completed.length}/${tasks.length} assignments completed (${tasks.filter(t => t.review_status === 'Approved').length} approved).\nStudy: ${(minutes / 60).toFixed(1)} tracked hours. ${problems.filter(p => p.status === 'Solved').length} DSA problems solved overall.\n${pending.length ? `Still open: ${pending.map(t => t.title).join(', ')}.` : 'All assigned tasks are complete.'}\n${overdue.length ? `Overdue: ${overdue.map(t => t.title).join(', ')}.` : 'No overdue assignments.'}\n${repeated.length ? `Revision focus: ${[...new Set(repeated.map(r => r.topic))].join(', ')}.` : 'No revision topics currently flagged for extra practice.'}\n${retro?.difficulties ? `Reported blocker: ${retro.difficulties}` : ''}\n\nRule-based summary from saved records. Recommendations are prompts for mentor and student review.`;
  res.json(row(await result<any>(db.from('weekly_reports').upsert({ board_id: board.id, content, source: 'rule-based' }, { onConflict: 'board_id' }).select().single())));
}));

const distDir = path.resolve(process.cwd(), 'dist');
app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.use((err: Error & { code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`WeeklyFlow API listening on ${port}`));
