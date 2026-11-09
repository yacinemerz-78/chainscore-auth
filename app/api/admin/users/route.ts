/**
 * GET  /api/admin/users        — liste des utilisateurs avec abonnement
 * POST /api/admin/users        — actions de support (patch abonnement, reset passkeys, delete)
 */
export const dynamic = "force-dynamic"; // désactive le cache Vercel sur cette route

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import type { SubscriptionStatus } from "@/types/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

async function assertAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Bypass ADMIN_EMAIL (même logique que middleware et admin/page.tsx)
  const adminEmailTrimmed = ADMIN_EMAIL.trim();
  const userEmailTrimmed  = (user.email ?? "").trim();
  if (adminEmailTrimmed && userEmailTrimmed === adminEmailTrimmed) return user;

  // Fallback : vérification rôle en DB via service_role (bypass RLS)
  const service = await createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return null;
  return user;
}

// ── GET — liste utilisateurs ─────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") ?? "";
  const page   = parseInt(searchParams.get("page") ?? "1", 10);
  const limit  = 20;
  const from   = (page - 1) * limit;

  const service = await createServiceClient();

  // ── 1. Récupérer les profils (sans jointure) ──────────────────────────────
  // La jointure inline `subscriptions(…)` peut silencieusement retourner 0
  // résultats si PostgREST n'a pas détecté la relation (FK pas encore reconnue).
  // On fait deux requêtes séparées pour garantir que les profils sont toujours
  // remontés, même sans abonnement associé.
  let profilesQuery = service
    .from("profiles")
    .select("id, email, full_name, role, created_at", { count: "exact" })
    .neq("role", "admin")
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (search) {
    profilesQuery = profilesQuery.ilike("email", `%${search}%`);
  }

  const { data: profiles, count, error } = await profilesQuery;
  if (error) {
    console.error("[admin/users] erreur requête profiles :", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ users: [], total: count ?? 0, page, limit });
  }

  // ── 2. Récupérer les abonnements pour ces profils ─────────────────────────
  const userIds = profiles.map((p) => p.id);
  const { data: subscriptions } = await service
    .from("subscriptions")
    .select("user_id, status, trial_end, current_period_end, stripe_customer_id")
    .in("user_id", userIds);

  // Index par user_id pour lookup O(1)
  const subByUserId = Object.fromEntries(
    (subscriptions ?? []).map((s) => [s.user_id, s])
  );

  // ── 3. Assembler la réponse ───────────────────────────────────────────────
  const users = profiles.map((p) => ({
    ...p,
    subscriptions: subByUserId[p.id] ? [subByUserId[p.id]] : [],
  }));

  return NextResponse.json({ users, total: count ?? 0, page, limit });
}

// ── POST — actions de support ─────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = await request.json();
  const { action, userId } = body as {
    action:  "set_subscription" | "reset_passkeys" | "force_signout" | "delete_user" | "extend_trial";
    userId:  string;
    payload?: Record<string, unknown>;
  };

  if (!action || !userId) return NextResponse.json({ error: "action et userId requis" }, { status: 400 });

  const service = await createServiceClient();

  // Récupérer l'email pour le log
  const { data: target } = await service.from("profiles").select("email").eq("id", userId).single();
  const targetEmail = target?.email ?? "unknown";

  // ── Action : modifier le statut d'abonnement ────────────────────────────
  if (action === "set_subscription") {
    const { status } = body.payload as { status: SubscriptionStatus };
    const { error } = await service.from("subscriptions").upsert({
      user_id: userId,
      status:  status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      event_type: "subscription_change",
      user_id:    userId,
      user_email: targetEmail,
      metadata:   { action, new_status: status, by_admin: admin.email },
    });
    return NextResponse.json({ success: true });
  }

  // ── Action : prolonger l'essai ──────────────────────────────────────────
  if (action === "extend_trial") {
    const days = (body.payload as { days?: number })?.days ?? 7;
    const newEnd = new Date(Date.now() + days * 86400000).toISOString();

    await service.from("subscriptions").upsert({
      user_id:  userId,
      status:   "trialing",
      trial_end: newEnd,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    await logActivity({
      event_type: "admin_action",
      user_id:    userId,
      user_email: targetEmail,
      metadata:   { action, days, new_trial_end: newEnd, by_admin: admin.email },
    });
    return NextResponse.json({ success: true });
  }

  // ── Action : reset passkeys ─────────────────────────────────────────────
  if (action === "reset_passkeys") {
    const { error } = await service
      .from("webauthn_credentials")
      .delete()
      .eq("user_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      event_type: "passkey_reset",
      user_id:    userId,
      user_email: targetEmail,
      metadata:   { by_admin: admin.email },
    });
    return NextResponse.json({ success: true });
  }

  // ── Action : forcer la déconnexion ──────────────────────────────────────
  if (action === "force_signout") {
    // Révoque toutes les sessions via l'API admin Supabase
    const { createClient: createSupabaseClient } = await import("@supabase/supabase-js");
    const adminClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    await adminClient.auth.admin.signOut(userId);

    await logActivity({
      event_type: "admin_action",
      user_id:    userId,
      user_email: targetEmail,
      metadata:   { action: "force_signout", by_admin: admin.email },
    });
    return NextResponse.json({ success: true });
  }

  // ── Action : supprimer le compte ────────────────────────────────────────
  if (action === "delete_user") {
    const { createClient: createSupabaseClient } = await import("@supabase/supabase-js");
    const adminClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    // Supprime l'utilisateur auth (cascade supprime le profile + subscriptions via FK)
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      event_type: "account_deleted",
      user_id:    null,
      user_email: targetEmail,
      metadata:   { deleted_id: userId, by_admin: admin.email },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
