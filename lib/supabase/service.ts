import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Service role client bypasses RLS — use only in server-side API routes.
// Never import this in client components or expose the key to the browser.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
