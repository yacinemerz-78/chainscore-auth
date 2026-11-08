/**
 * GET /api/admin/stats — KPIs du dashboard admin
 * Protégé : service_role + vérification admin en middleware
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  // Vérifier que c'est bien l'admin connecté
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const service = await createServiceClient();
  const { data: stats } = await service.rpc("get_admin_stats");

  return NextResponse.json(stats ?? {
    total_users: 0, trialing: 0, active: 0, canceled: 0, mrr_estimate: 0,
  });
}
