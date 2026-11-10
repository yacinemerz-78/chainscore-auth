/**
 * Dashboard Admin — MyChainScore
 * Accessible uniquement si role='admin' (vérifié en middleware)
 *
 * Stratégie d'accès en deux niveaux :
 * 1. Bypass ADMIN_EMAIL : si user.email === ADMIN_EMAIL → accès immédiat,
 *    indépendamment du rôle en base (failsafe si profil absent ou mal configuré)
 * 2. Vérification rôle DB : pour les admins dont l'email ≠ ADMIN_EMAIL
 */
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import AdminDashboard from "@/components/admin/AdminDashboard";
import TelegramLinkCard from "@/components/dashboard/TelegramLinkCard";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

export default async function AdminPage() {
  // createClient() pour vérifier la session auth (cookies)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[admin/page] Non connecté → /login");
    redirect("/login");
  }

  const userEmailTrimmed  = (user.email ?? "").trim();
  const adminEmailTrimmed = ADMIN_EMAIL.trim();

  // ── Niveau 1 : bypass ADMIN_EMAIL ─────────────────────────────────────────
  // Si l'email correspond à ADMIN_EMAIL → accès accordé sans vérifier la DB.
  // Failsafe critique : fonctionne même si public.profiles est absent ou
  // si le rôle n'a pas encore été mis à jour en base.
  if (adminEmailTrimmed && userEmailTrimmed === adminEmailTrimmed) {
    console.log(`[admin/page] ✅ Bypass ADMIN_EMAIL — accès accordé pour ${user.email}`);
    const service = await createServiceClient();
    const { data: adminProfile } = await service
      .from("profiles")
      .select("telegram_linked_at")
      .eq("id", user.id)
      .single();
    return (
      <>
        <div className="max-w-2xl mx-auto px-4 pt-6">
          <TelegramLinkCard telegramLinkedAt={adminProfile?.telegram_linked_at ?? null} />
        </div>
        <AdminDashboard adminEmail={user.email!} adminName={null} />
      </>
    );
  }

  // ── Niveau 2 : vérification rôle DB ───────────────────────────────────────
  // Pour les admins dont l'email ≠ ADMIN_EMAIL (rôle configuré directement en DB)
  const serviceSupabase = await createServiceClient();
  const { data: profile, error: profileError } = await serviceSupabase
    .from("profiles")
    .select("role, email")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error(`[admin/page] Erreur lecture profil DB : ${profileError.message} — user=${user.email}`);
    redirect("/login");
  }

  if (!profile || profile.role !== "admin") {
    console.warn(`[admin/page] Accès refusé — user=${user.email} role=${profile?.role ?? "null"}`);
    redirect("/login");
  }

  console.log(`[admin/page] ✅ Accès accordé via rôle DB — user=${user.email}`);
  return (
    <>
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <TelegramLinkCard telegramLinkedAt={null} />
      </div>
      <AdminDashboard adminEmail={profile.email} adminName={null} />
    </>
  );
}
