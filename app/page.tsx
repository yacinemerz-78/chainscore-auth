/**
 * Landing page publique — MyChainScore
 *
 * - Utilisateur non connecté → affiche la landing page marketing
 * - Utilisateur connecté (admin) → redirect /admin
 * - Utilisateur connecté (abonnement actif / essai) → redirect vers l'app principale
 * - Utilisateur connecté (pas d'abonnement) → redirect /register/checkout
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import Logo from "@/components/ui/Logo";
import { CheckCircle2, Zap, Bell, Shield, ArrowRight } from "lucide-react";
import Showreel from "@/components/landing/Showreel";

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL ?? "";

export default async function LandingPage() {
  // ── Vérification session ────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Admin → /admin
    const adminEmailTrimmed = ADMIN_EMAIL.trim();
    const userEmailTrimmed  = (user.email ?? "").trim();
    if (adminEmailTrimmed && userEmailTrimmed === adminEmailTrimmed) {
      redirect("/admin");
    }

    try {
      const serviceSupabase = await createServiceClient();
      const { data: profile } = await serviceSupabase
        .from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role === "admin") redirect("/admin");
    } catch { /* continue */ }

    // Vérification abonnement
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("status, trial_end")
      .eq("user_id", user.id)
      .maybeSingle();

    const now = Date.now();
    const isActive =
      subscription?.status === "active" ||
      (subscription?.status === "trialing" &&
        subscription.trial_end &&
        new Date(subscription.trial_end).getTime() > now);

    if (isActive) redirect(MAIN_APP_URL);
    redirect("/register/checkout");
  }

  // ── Rendu public ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg text-ink-white overflow-x-hidden">

      {/* Halo de fond */}
      <div
        aria-hidden
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "radial-gradient(ellipse, #f5a623 0%, transparent 70%)" }}
      />

      {/* ── Navbar ───────────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo size="md" />
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-ink-light hover:text-ink-white transition-colors px-3 py-2"
            >
              Se connecter
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold bg-gold hover:bg-amber-400 text-bg rounded-xl px-4 py-2 transition-all duration-200 active:scale-[0.98]"
            >
              Essai gratuit
            </Link>
          </nav>
        </div>
      </header>

      <main className="pt-16">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-24 pb-20 text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-1.5 text-xs font-medium text-gold mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
            30 jours d&apos;essai gratuit — sans carte bancaire
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-ink-white leading-tight tracking-tight max-w-4xl mx-auto">
            Pilotez votre portefeuille crypto{" "}
            <span className="text-gold">sans bruit,</span>{" "}
            ni complexité.
          </h1>

          <p className="mt-6 text-lg text-ink leading-relaxed max-w-2xl mx-auto">
            Suivez vos positions, analysez vos performances en un coup d&apos;œil et recevez
            chaque matin votre rapport personnalisé sur{" "}
            <span className="text-ink-light font-medium">Telegram</span>.
          </p>

          {/* CTA */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-gold hover:bg-amber-400 text-bg font-semibold rounded-xl px-8 py-4 text-base transition-all duration-200 active:scale-[0.98] shadow-lg shadow-gold/20"
            >
              Démarrer mon essai gratuit
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 bg-panel-2 hover:bg-line border border-line text-ink-white font-medium rounded-xl px-8 py-4 text-base transition-all duration-200"
            >
              J&apos;ai déjà un compte
            </Link>
          </div>

          {/* Badge réassurance */}
          <p className="mt-5 text-sm text-ink flex items-center justify-center gap-2 flex-wrap">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-up" />
              Configuration en 2 minutes
            </span>
            <span className="text-line">•</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-up" />
              Alertes Telegram incluses
            </span>
            <span className="text-line">•</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-up" />
              2 € / mois après l&apos;essai
            </span>
          </p>
        </section>

        {/* ── Showreel interactif ──────────────────────────────────────── */}
        <Showreel />

        {/* ── Fonctionnalités ───────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-ink-white">
              L&apos;essentiel, sans le superflu
            </h2>
            <p className="mt-3 text-ink max-w-xl mx-auto">
              MyChainScore est conçu pour les investisseurs qui veulent rester informés
              sans passer des heures devant des graphiques.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Carte 1 */}
            <div className="bg-panel border border-line rounded-2xl p-6 hover:border-gold/30 transition-colors duration-300">
              <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center mb-5">
                <Zap className="w-5 h-5 text-gold" />
              </div>
              <h3 className="text-lg font-semibold text-ink-white mb-3">
                Vue d&apos;ensemble claire
              </h3>
              <p className="text-ink text-sm leading-relaxed">
                Centralisez vos jetons, prix d&apos;achat et quantités sur une interface épurée,
                sans graphiques illisibles.
              </p>
            </div>

            {/* Carte 2 */}
            <div className="bg-panel border border-line rounded-2xl p-6 hover:border-gold/30 transition-colors duration-300">
              <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center mb-5">
                <Bell className="w-5 h-5 text-gold" />
              </div>
              <h3 className="text-lg font-semibold text-ink-white mb-3">
                Alertes Telegram quotidiennes
              </h3>
              <p className="text-ink text-sm leading-relaxed">
                Recevez chaque matin à heure fixe un résumé précis de vos positions
                directement sur votre téléphone.
              </p>
            </div>

            {/* Carte 3 */}
            <div className="bg-panel border border-line rounded-2xl p-6 hover:border-gold/30 transition-colors duration-300">
              <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center mb-5">
                <Shield className="w-5 h-5 text-gold" />
              </div>
              <h3 className="text-lg font-semibold text-ink-white mb-3">
                Zéro distraction
              </h3>
              <p className="text-ink text-sm leading-relaxed">
                Pas de trading complexe ni de publicités. Un outil conçu pour les investisseurs
                qui veulent garder le contrôle.
              </p>
            </div>
          </div>
        </section>

        {/* ── Comment ça marche ─────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 border-t border-line">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-ink-white">
              Prêt en 3 étapes
            </h2>
            <p className="mt-3 text-ink">
              De zéro à votre premier rapport Telegram en moins de 5 minutes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Ligne de connexion (desktop) */}
            <div className="hidden md:block absolute top-8 left-1/4 right-1/4 h-px bg-line" />

            {[
              {
                step: "01",
                title: "Créez votre compte",
                desc: "Inscription en quelques secondes, sans carte bancaire. 30 jours d'essai offerts.",
              },
              {
                step: "02",
                title: "Ajoutez vos positions",
                desc: "Renseignez vos cryptos, quantités et prix d'achat. Interface simple et rapide.",
              },
              {
                step: "03",
                title: "Connectez Telegram",
                desc: "Liez votre compte Telegram et laissez MyChainScore travailler pour vous chaque matin.",
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-gold/10 border border-gold/20 flex items-center justify-center mb-5 relative z-10">
                  <span className="text-gold font-bold text-lg">{step}</span>
                </div>
                <h3 className="text-base font-semibold text-ink-white mb-2">{title}</h3>
                <p className="text-ink text-sm leading-relaxed max-w-xs">{desc}</p>
              </div>
            ))}
          </div>

          {/* CTA final */}
          <div className="text-center mt-14">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-gold hover:bg-amber-400 text-bg font-semibold rounded-xl px-8 py-4 text-base transition-all duration-200 active:scale-[0.98] shadow-lg shadow-gold/20"
            >
              Commencer gratuitement
              <ArrowRight className="w-4 h-4" />
            </Link>
            <p className="mt-3 text-xs text-ink">
              Après 30 jours : 2 € / mois — résiliable à tout moment.
            </p>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-20 border-t border-line">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-ink-white">
              Questions fréquentes
            </h2>
            <p className="mt-3 text-ink">
              Tout ce que vous voulez savoir avant de commencer.
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                q: "Dois-je connecter mon exchange ou mon wallet ?",
                a: "Non, jamais. Vous saisissez uniquement vos cryptos, quantités et prix d'achat manuellement. MyChainScore ne touche pas à vos fonds et n'a aucun accès à vos comptes.",
              },
              {
                q: "Quelles cryptomonnaies sont supportées ?",
                a: "Les principales cryptos du marché sont prises en charge : Bitcoin (BTC), Ethereum (ETH), Solana (SOL), et bien d'autres. La liste s'élargit régulièrement.",
              },
              {
                q: "Comment fonctionne le score de santé ?",
                a: "Le score (de 0 à 100) synthétise l'état de votre portefeuille : diversification, performances globales et exposition au risque. Pas de jargon technique — juste un indicateur clair pour savoir si votre portefeuille est en bonne forme.",
              },
              {
                q: "Le briefing Telegram est-il vraiment automatique ?",
                a: "Oui. Chaque matin à 8h00, notre bot Telegram vous envoie un résumé personnalisé de vos positions sans aucune action de votre part. Vous avez votre rapport avant même d'ouvrir votre ordinateur.",
              },
              {
                q: "Est-ce que mes données sont en sécurité ?",
                a: "Vos données sont hébergées en Europe et chiffrées. Comme nous n'avons accès à aucun exchange ni wallet, votre argent reste inaccessible depuis notre plateforme, quoi qu'il arrive.",
              },
              {
                q: "Combien ça coûte après l'essai gratuit ?",
                a: "2 € par mois seulement, sans engagement. L'essai dure 30 jours et ne nécessite aucune carte bancaire. Vous décidez en connaissance de cause.",
              },
              {
                q: "Je suis débutant en crypto — c'est fait pour moi ?",
                a: "C'est exactement pour vous. MyChainScore est conçu pour les investisseurs qui veulent suivre leur portefeuille sans passer des heures sur des graphiques complexes. Pas de trading, pas de levier, pas de jargon.",
              },
            ].map(({ q, a }, i) => (
              <details
                key={i}
                className="group bg-panel border border-line rounded-2xl overflow-hidden"
              >
                <summary className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer list-none select-none hover:bg-panel-2 transition-colors duration-200">
                  <span className="font-semibold text-sm text-ink-white">{q}</span>
                  <span className="flex-shrink-0 w-5 h-5 rounded-full border border-line flex items-center justify-center text-ink group-open:rotate-45 transition-transform duration-300 text-xs">
                    +
                  </span>
                </summary>
                <div className="px-6 pb-5 pt-1">
                  <p className="text-sm text-ink leading-relaxed">{a}</p>
                </div>
              </details>
            ))}
          </div>

          <div className="text-center mt-10">
            <p className="text-sm text-ink">
              Une autre question ?{" "}
              <Link href="/login" className="text-gold hover:underline">
                Contactez-nous
              </Link>
            </p>
          </div>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-line mt-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="text-xs text-ink">
            © 2026 MyChainScore — Tous droits réservés
          </p>
          <Link href="/login" className="text-xs text-ink hover:text-gold transition-colors">
            Se connecter
          </Link>
        </div>
      </footer>

    </div>
  );
}
