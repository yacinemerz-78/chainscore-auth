/**
 * Dashboard Admin — MyChainScore
 * Accessible uniquement si role='admin' (vérifié en middleware)
 *
 * Utilise createServiceClient() (service_role) pour lire public.profiles
 * en bypassant la RLS — createClient() (anon) peut être bloqué par la RLS
 * et retourner null, ce qui enverrait l'admin vers /login en boucle.
 */
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import AdminDashboard from "@/components/admin/AdminDashboard";

export default async function AdminPage() {
  // createClient() pour vérifier la session auth (cookies)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[admin/page] Non connecté → /login");
    redirect("/login");
  }

  // createServiceClient() pour lire le profil (bypasse la RLS)
  const serviceSupabase = await createServiceClient();
  const { data: profile, error: profileError } = await serviceSupabase
    .from("profiles")
    .select("role, email, full_name")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error(`[admin/page] Erreur lecture profil DB : ${profileError.message}`);
    redirect("/login");
  }

  if (!profile || profile.role !== "admin") {
    console.warn(`[admin/page] Accès refusé — user=${user.email} role=${profile?.role ?? "null"}`);
    redirect("/login");
  }

  console.log(`[admin/page] ✅ Accès accordé — user=${user.email}`);
  return <AdminDashboard adminEmail={profile.email} adminName={profile.full_name} />;
}
