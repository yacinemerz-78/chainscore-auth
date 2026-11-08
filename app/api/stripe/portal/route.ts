/**
 * POST /api/stripe/portal
 * Crée une Stripe Billing Portal Session pour permettre à l'utilisateur
 * de gérer ou annuler son abonnement.
 *
 * Retourne : { url: string } — URL de redirection vers le portail Stripe
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-02-24.acacia",
});

export async function POST(_req: NextRequest) {
  // ── 1. Vérifier l'authentification ────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // ── 2. Récupérer le Stripe Customer ID ────────────────────────────────────
  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subError || !subscription?.stripe_customer_id) {
    return NextResponse.json(
      { error: "Aucun abonnement Stripe trouvé pour ce compte" },
      { status: 404 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const mainAppUrl = process.env.MAIN_APP_URL ?? "https://chainscore-app.vercel.app/";

  // ── 3. Créer la Billing Portal Session ───────────────────────────────────
  const portalSession = await stripe.billingPortal.sessions.create({
    customer:   subscription.stripe_customer_id,
    return_url: mainAppUrl,       // retour vers l'app principale après action
  });

  return NextResponse.json({ url: portalSession.url });
}
