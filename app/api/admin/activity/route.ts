/**
 * GET /api/admin/activity — Journal d'activité (50 dernières entrées)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single() as { data: { role: string } | null; error: unknown };
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

  const service = await createServiceClient();
  const { data, error } = await service
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}
