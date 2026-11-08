/**
 * Client Supabase côté navigateur (composants Client)
 * Utilise @supabase/ssr pour la gestion des cookies.
 * Note: générique <Database> retiré — l'inférence causait des 'never' sur Vercel.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createBrowserClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
