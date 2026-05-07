/**
 * Server-side Supabase client.
 * Use inside Server Components, Route Handlers and Server Actions.
 * Cookies-aware (auth tokens stored in cookies via @supabase/ssr).
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot set cookies — caught & ignored.
            // Middleware handles refresh.
          }
        },
      },
    }
  );
}

/**
 * Service-role client for trusted server-only routes
 * (Telegram webhook, cron-jobs, etc.). NEVER expose to the browser.
 *
 * Memoized at module scope so repeated calls (e.g. inside a single bot
 * webhook handler that needs both auth + db access) reuse the same
 * connection-pool-aware HTTP client. The Supabase JS client itself does
 * keep-alive internally; sharing a single instance lets it reuse those
 * sockets across requests in the same Node lambda invocation, which
 * matters under cron + webhook bursts.
 *
 * If `SUPABASE_DB_POOLER_URL` is set (Supavisor — port 6543, transaction
 * mode), it's exported via the `pooler` getter for callers that prefer
 * direct SQL via `postgres-js` / `pg`. The Supabase JS client uses the
 * REST endpoint, which is already pooled at the platform edge.
 */
import { createClient as createSupabaseRaw, type SupabaseClient } from "@supabase/supabase-js";

let _serviceClient: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  _serviceClient = createSupabaseRaw(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return _serviceClient;
}

