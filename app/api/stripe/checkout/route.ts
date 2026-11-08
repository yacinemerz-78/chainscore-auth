/**
 * POST /api/stripe/checkout
 * Crée une Stripe Checkout Session pour l'abonnement à 2 €/mois
 * avec 30 jours d'essai gratuit.
 *
 * Body JSON (optionnel) : {}
 * Retourne : { url: string } — URL de redirection vers Stripe
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const mainAppUrl = process.env.MAIN_APP_URL ?? "https://chainscore-app.vercel.app/";

  // ── 2. Récupérer ou créer un Stripe Customer ──────────────────────────────
  // On vérifie si l'utilisateur a déjà un stripe_customer_id en base
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerId = subscription?.stripe_customer_id ?? null;

  if (!customerId) {
    // Créer un nouveau Customer Stripe
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        supabase_user_id: user.id,
      },
    });
    customerId = customer.id;
  }

  // ── 3. Créer la Checkout Session ──────────────────────────────────────────
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: user.id,            // identifiant Supabase pour le webhook
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!, // price_xxx — 2 €/mois récurrent
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: 30,
      metadata: {
        supabase_user_id: user.id,
      },
    },
    // Pas de paiement demandé immédiatement pendant l'essai
    payment_method_collection: "if_required",
    success_url: `${mainAppUrl}?checkout=success`,
    cancel_url: `${appUrl}/register/checkout?canceled=1`,
    metadata: {
      supabase_user_id: user.id,
    },
    locale: "fr",
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Impossible de créer la session de paiement" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: session.url });
}
