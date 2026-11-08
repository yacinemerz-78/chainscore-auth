/**
 * Dashboard Admin — MyChainScore
 * Accessible uniquement si role='admin' (vérifié en middleware)
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminDashboard from "@/components/admin/AdminDashboard";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Cast explicite : @supabase/ssr infère `never` sur certaines versions Vercel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileResult = await (supabase as any)
    .from("profiles")
    .select("role, email, full_name")
    .eq("id", user.id)
    .single() as { data: { role: string; email: string; full_name: string | null } | null; error: unknown };
  const profile = profileResult.data;

  if (!profile || profile.role !== "admin") redirect("/login");

  return <AdminDashboard adminEmail={profile.email} adminName={profile.full_name} />;
}
