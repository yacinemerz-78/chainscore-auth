/**
 * GET /api/admin/stats — KPIs du dashboard admin
 * Protégé : service_role + vérification admin en middleware
 */
export const dynamic = "force-dynamic"; // désactive le cache Vercel sur cette route

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

export async function GET() {
  // Vérifier que c'est bien l'admin connecté
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Bypass ADMIN_EMAIL (même logique que middleware et admin/page.tsx)
  const adminEmailTrimmed = ADMIN_EMAIL.trim();
  const userEmailTrimmed  = (user.email ?? "").trim();
  const isAdminByEmail    = adminEmailTrimmed && userEmailTrimmed === adminEmailTrimmed;

  if (!isAdminByEmail) {
    // Fallback : vérification rôle en DB via service_role (bypass RLS)
    const service = await createServiceClient();
    const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // ── Calcul des stats directement en JS (plus fiable que service.rpc) ────────
  // La fonction SQL `get_admin_stats()` peut retourner NULL si elle n'est pas
  // encore déployée sur le projet Supabase. On calcule ici les mêmes valeurs
  // avec des requêtes simples via service_role (bypass RLS garanti).
  const service = await createServiceClient();

  const [
    { count: total_users },
    { count: trialing },
    { count: active },
    { count: canceled },
  ] = await Promise.all([
    service
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .neq("role", "admin"),
    service
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "trialing"),
    service
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    service
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "canceled"),
  ]);

  const stats = {
    total_users:  total_users  ?? 0,
    trialing:     trialing     ?? 0,
    active:       active       ?? 0,
    canceled:     canceled     ?? 0,
    mrr_estimate: (active ?? 0) * 2,   // même formule que la RPC SQL
  };

  return NextResponse.json(stats);
}
