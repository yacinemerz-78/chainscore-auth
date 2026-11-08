/**
 * Page racine — redirige automatiquement.
 * - Utilisateur connecté avec abonnement actif → app principale
 * - Utilisateur non connecté → /login
 * (Le middleware gère déjà la protection, cette page est un fallback)
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const MAIN_APP_URL =
  process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Vérifier si l'abonnement est actif
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

  // Pas d'abonnement → page de paiement (Bloc 2)
  redirect("/register/checkout");
}
