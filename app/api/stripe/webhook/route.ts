/**
 * POST /api/stripe/webhook
 * Webhook Stripe — vérification de signature + mise à jour de la table subscriptions
 *
 * Événements traités :
 *   checkout.session.completed         → upsert subscription (statut trialing/active)
 *   customer.subscription.updated      → mise à jour statut, dates, stripe_subscription_id
 *   customer.subscription.deleted      → statut = canceled
 *   invoice.payment_failed             → statut = past_due
 *
 * IMPORTANT : le body doit rester RAW (Buffer) pour valider la signature Stripe.
 * Next.js 15 App Router ne parse pas automatiquement — on lit request.body directement.
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import type { SubscriptionStatus } from "@/types/supabase";

/** Convertit un statut Stripe en SubscriptionStatus DB (fallback = "canceled") */
function toDbStatus(s: string): SubscriptionStatus {
  const known: SubscriptionStatus[] = [
    "trialing","active","past_due","canceled","incomplete","incomplete_expired","unpaid"
  ];
  return known.includes(s as SubscriptionStatus) ? (s as SubscriptionStatus) : "canceled";
}

// Désactiver le body parser Next.js pour cette route (nécessaire pour Stripe)
export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-02-24.acacia",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extrait le supabase_user_id depuis les différents endroits où Stripe le stocke.
 * Priorité : metadata de la subscription > metadata de la session > customer metadata.
 */
function extractUserId(
  obj: Stripe.Subscription | Stripe.Checkout.Session | Stripe.Invoice,
  customerMetadata?: Stripe.Customer["metadata"]
): string | null {
  if ("metadata" in obj && obj.metadata?.supabase_user_id) {
    return obj.metadata.supabase_user_id;
  }
  if (customerMetadata?.supabase_user_id) {
    return customerMetadata.supabase_user_id;
  }
  return null;
}

/**
 * Résout le customerId et récupère ses métadonnées si nécessaire.
 */
async function getCustomerMeta(
  customerId: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): Promise<{ id: string; metadata: Stripe.Customer["metadata"] }> {
  if (!customerId) return { id: "", metadata: {} };

  if (typeof customerId === "string") {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return { id: customerId, metadata: {} };
    return { id: customerId, metadata: (customer as Stripe.Customer).metadata };
  }

  if (customerId.deleted) return { id: customerId.id, metadata: {} };
  return { id: customerId.id, metadata: (customerId as Stripe.Customer).metadata };
}

// ── Handler principal ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Lire le body brut (Buffer) — indispensable pour la vérification Stripe
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Signature manquante" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[webhook] Signature invalide :", err);
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 });
  }

  const service = await createServiceClient();

  try {
    switch (event.type) {
      // ── checkout.session.completed ────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // client_reference_id = supabase user id (défini dans la création de session)
        const userId =
          session.client_reference_id ??
          session.metadata?.supabase_user_id ??
          null;

        if (!userId) {
          console.warn("[webhook] checkout.session.completed : user_id introuvable");
          break;
        }

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;

        // Récupérer les détails de la subscription pour avoir les dates
        let trialEnd: string | null = null;
        let currentPeriodEnd: string | null = null;
        let subStatus: SubscriptionStatus = "trialing";

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          trialEnd = sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null;
          currentPeriodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
          subStatus = toDbStatus(sub.status);
        }

        const { error } = await service.from("subscriptions").upsert(
          {
            user_id:                userId,
            stripe_customer_id:     customerId,
            stripe_subscription_id: subscriptionId,
            status:                 subStatus,
            trial_end:              trialEnd,
            current_period_end:     currentPeriodEnd,
            updated_at:             new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) console.error("[webhook] upsert subscription :", error);

        await logActivity({
          event_type: "subscription_change",
          user_id:    userId,
          metadata: {
            stripe_event: "checkout.session.completed",
            status:        subStatus,
            subscription:  subscriptionId,
          },
        });
        break;
      }

      // ── customer.subscription.updated ─────────────────────────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const { id: customerId, metadata: customerMeta } = await getCustomerMeta(sub.customer);
        const userId = extractUserId(sub, customerMeta);

        if (!userId) {
          console.warn("[webhook] subscription.updated : user_id introuvable, customerId=", customerId);
          break;
        }

        const { error } = await service.from("subscriptions").upsert(
          {
            user_id:                userId,
            stripe_customer_id:     customerId,
            stripe_subscription_id: sub.id,
            status:                 toDbStatus(sub.status),
            trial_end:              sub.trial_end
              ? new Date(sub.trial_end * 1000).toISOString()
              : null,
            current_period_end:     sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
            updated_at:             new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) console.error("[webhook] subscription.updated upsert :", error);

        await logActivity({
          event_type: "subscription_change",
          user_id:    userId,
          metadata: {
            stripe_event: "customer.subscription.updated",
            status:        sub.status,
            subscription:  sub.id,
          },
        });
        break;
      }

      // ── customer.subscription.deleted ─────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const { id: customerId, metadata: customerMeta } = await getCustomerMeta(sub.customer);
        const userId = extractUserId(sub, customerMeta);

        if (!userId) {
          console.warn("[webhook] subscription.deleted : user_id introuvable");
          break;
        }

        const { error } = await service.from("subscriptions").upsert(
          {
            user_id:                userId,
            stripe_customer_id:     customerId,
            stripe_subscription_id: sub.id,
            status:                 "canceled",
            updated_at:             new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) console.error("[webhook] subscription.deleted upsert :", error);

        await logActivity({
          event_type: "subscription_change",
          user_id:    userId,
          metadata: {
            stripe_event: "customer.subscription.deleted",
            status:        "canceled",
          },
        });
        break;
      }

      // ── invoice.payment_failed ─────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const { id: customerId, metadata: customerMeta } = await getCustomerMeta(
          invoice.customer
        );
        const userId = extractUserId(invoice, customerMeta);

        if (!userId) {
          console.warn("[webhook] invoice.payment_failed : user_id introuvable");
          break;
        }

        const { error } = await service.from("subscriptions").upsert(
          {
            user_id:            userId,
            stripe_customer_id: customerId,
            status:             "past_due",
            updated_at:         new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) console.error("[webhook] invoice.payment_failed upsert :", error);

        await logActivity({
          event_type: "error",
          user_id:    userId,
          metadata: {
            stripe_event: "invoice.payment_failed",
            invoice_id:   invoice.id,
          },
        });
        break;
      }

      default:
        // Événements non traités — on répond 200 pour éviter les relivraisons
        break;
    }
  } catch (err) {
    console.error("[webhook] Erreur handler :", err);
    // On renvoie 200 pour éviter que Stripe ne réessaie à l'infini
    // (l'erreur est loggée et peut être déboguée depuis le dashboard Stripe)
  }

  return NextResponse.json({ received: true });
}
