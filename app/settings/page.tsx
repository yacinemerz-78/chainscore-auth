/**
 * /settings — Page paramètres utilisateur
 *
 * Accessible à tout utilisateur connecté avec un abonnement actif.
 * Affiche la liaison Telegram et les infos du compte.
 */
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import TelegramLinkCard from "@/components/dashboard/TelegramLinkCard";
import Logo from "@/components/ui/Logo";
import Link from "next/link";

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Chargement du profil (telegram_linked_at)
  const service = await createServiceClient();
  const { data: profile } = await service
    .from("profiles")
    .select("email, full_name, telegram_chat_id, telegram_linked_at")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  return (
    <div className="min-h-screen bg-bg text-ink-white">
      {/* Header */}
      <header className="border-b border-line">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href={MAIN_APP_URL} className="flex items-center gap-2">
            <Logo size="sm" />
            <span className="font-semibold text-sm text-ink-white">MyChainScore</span>
          </Link>
          <Link
            href={MAIN_APP_URL}
            className="text-xs text-ink hover:text-ink-white transition-colors"
          >
            ← Retour à l'app
          </Link>
        </div>
      </header>

      {/* Contenu */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-ink-white">Paramètres</h1>
          <p className="text-sm text-ink mt-1">{profile.email}</p>
        </div>

        {/* Carte Telegram */}
        <TelegramLinkCard telegramLinkedAt={profile.telegram_linked_at} />

        {/* Info compte */}
        <div className="bg-panel border border-line rounded-2xl p-6 space-y-3">
          <h3 className="font-semibold text-sm text-ink-white">Mon compte</h3>
          <div className="text-sm text-ink space-y-1">
            <p>Email : <span className="text-ink-white">{profile.email}</span></p>
            {profile.full_name && (
              <p>Nom : <span className="text-ink-white">{profile.full_name}</span></p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
