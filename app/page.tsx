/**
 * Page racine — redirige automatiquement.
 * - Admin (ADMIN_EMAIL ou role='admin') → /admin (bypass du paywall Stripe)
 * - Utilisateur connecté avec abonnement actif → app principale
 * - Utilisateur connecté sans abonnement actif → tunnel checkout
 * - Utilisateur non connecté → /login
 * (Le middleware gère déjà la protection des routes, cette page est un fallback)
 */
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAIN_APP_URL =
  process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";
const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ?? "";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // ── Bypass admin : ne jamais passer par le check d'abonnement Stripe ──────
  // Vérification 1 : email correspond à ADMIN_EMAIL
  if (ADMIN_EMAIL && user.email === ADMIN_EMAIL) {
    redirect("/admin");
  }

  // Vérification 2 : rôle 'admin' en base (via service_role pour bypasser la RLS)
  try {
    const serviceSupabase = await createServiceClient();
    const { data: profile } = await serviceSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role === "admin") {
      redirect("/admin");
    }
  } catch {
    // Erreur de lecture — on continue vers le flux normal
  }

  // ── Flux normal : vérification abonnement Stripe ──────────────────────────
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", user.id)
    .single();

  const isActive =
    subscription?.status === "active" ||
    subscription?.status === "trialing";

  if (isActive) {
    redirect(MAIN_APP_URL);
  }

  // Pas d'abonnement → page de paiement
  redirect("/register/checkout");
}
