import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from '@/lib/config';

export function createServerDatabase() {
  return createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    process.env.SUPABASE_SECRET_KEY?.trim() || requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: 'no-store',
            signal: AbortSignal.timeout(12000),
          }),
      },
    },
  );
}
