/**
 * GET /api/admin/stats — KPIs du dashboard admin
 * Protégé : service_role + vérification admin en middleware
 */
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

  const service = await createServiceClient();
  const { data: stats } = await service.rpc("get_admin_stats");

  return NextResponse.json(stats ?? {
    total_users: 0, trialing: 0, active: 0, canceled: 0, mrr_estimate: 0,
  });
}
