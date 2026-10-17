import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env before starting WeeklyFlow.');
}

// Server-only privileged client. Never import this module in browser code.
export const db: SupabaseClient = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

export async function result<T>(request: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) {
    const e = new Error(error.message) as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
  return data as T;
}

export function clientRow<T extends Record<string, any>>(row: T): Record<string, any> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key === 'id' ? '_id' : key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    value,
  ]));
}
