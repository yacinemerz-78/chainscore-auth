/**
 * POST /api/stripe/checkout
 * Crée une Stripe Checkout Session pour l'abonnement à 2 €/mois
 * avec 30 jours d'essai gratuit.
 *
 * Body JSON (optionnel) : {}
 * Retourne : { url: string } — URL de redirection vers Stripe
 *
 * IMPORTANT : toute exception est catchée — la route retourne TOUJOURS
 * un objet JSON valide, jamais une réponse vide (prévient "Unexpected end of JSON input").
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: NextRequest) {
  try {
    // ── 0. Vérifier les variables d'environnement critiques ──────────────────
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("[stripe/checkout] STRIPE_SECRET_KEY manquante");
      return NextResponse.json(
        { error: "Configuration Stripe manquante. Contacte le support." },
        { status: 500 }
      );
    }
    if (!process.env.STRIPE_PRICE_ID) {
      console.error("[stripe/checkout] STRIPE_PRICE_ID manquante");
      return NextResponse.json(
        { error: "Configuration Stripe manquante. Contacte le support." },
        { status: 500 }
      );
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia",
    });

    // ── 1. Vérifier l'authentification ────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const appUrl     = process.env.NEXT_PUBLIC_APP_URL     ?? "http://localhost:3000";
    const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app/";

    // ── 2. Récupérer ou créer un Stripe Customer ──────────────────────────────
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = subscription?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
    }

    // ── 3. Créer la Checkout Session ──────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      client_reference_id:  user.id,
      payment_method_types: ["card"],
      mode:                 "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        metadata: { supabase_user_id: user.id },
      },
      payment_method_collection: "if_required",
      success_url: `${mainAppUrl}?checkout=success`,
      cancel_url:  `${appUrl}/register/checkout?canceled=1`,
      metadata: { supabase_user_id: user.id },
      locale: "fr",
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Impossible de créer la session de paiement" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });

  } catch (err) {
    // Filet de sécurité : toute exception non prévue retourne du JSON,
    // jamais une réponse vide qui causerait "Unexpected end of JSON input"
    const message = err instanceof Error ? err.message : "Erreur interne";
    console.error("[stripe/checkout] Erreur non gérée :", message);
    return NextResponse.json(
      { error: `Erreur serveur : ${message}` },
      { status: 500 }
    );
  }
}
