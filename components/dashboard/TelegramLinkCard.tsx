"use client";

/**
 * TelegramLinkCard
 *
 * Affiche l'état de la liaison Telegram de l'utilisateur et permet :
 *   • État non lié  → bouton "Lier mon Telegram" qui génère un lien deep-link
 *   • État lié      → badge vert avec date de liaison + bouton "Délier"
 *
 * Props :
 *   telegramLinkedAt  — date ISO de liaison (null si non lié)
 *
 * Flux sécurisé :
 *   1. POST /api/telegram/request-link  → reçoit { link, expires_at }
 *   2. Ouvre le lien Telegram dans un nouvel onglet
 *   3. L'utilisateur envoie /start au bot → webhook enregistre le chat_id
 *   4. Après 3 s, le composant recharge la page pour refléter l'état lié
 */

import { useState } from "react";

interface Props {
  telegramLinkedAt: string | null;
}

export default function TelegramLinkCard({ telegramLinkedAt }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [linkOpened, setLinkOpened] = useState(false);

  // ── Lier ────────────────────────────────────────────────────────────────────
  async function handleLink() {
    setLoading(true);
    setError(null);

    try {
      const res  = await fetch("/api/telegram/request-link", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.link) {
        setError(data.error ?? "Erreur lors de la génération du lien");
        return;
      }

      // Ouvre le deep-link Telegram dans un nouvel onglet
      window.open(data.link, "_blank", "noopener,noreferrer");
      setLinkOpened(true);

      // Recharge après 4 s pour refléter le statut mis à jour par le webhook
      setTimeout(() => window.location.reload(), 4000);
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  // ── Délier ───────────────────────────────────────────────────────────────────
  async function handleUnlink() {
    if (!confirm("Délier votre compte Telegram ? Vous ne recevrez plus les alertes.")) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/telegram/unlink", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erreur lors de la déconnexion");
        return;
      }
      window.location.reload();
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  // ── Rendu ───────────────────────────────────────────────────────────────────
  return (
    <div className="bg-panel border border-line rounded-2xl p-6 space-y-4">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">📲</span>
        <div>
          <h3 className="font-semibold text-sm text-ink-white">Alertes Telegram</h3>
          <p className="text-xs text-ink mt-0.5">
            Recevez votre bilan crypto quotidien directement dans Telegram
          </p>
        </div>
      </div>

      {/* État */}
      {telegramLinkedAt ? (
        // ── Lié ─────────────────────────────────────────────────────────────
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-up bg-up/10 border border-up/20 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" />
              Telegram lié
            </span>
            <span className="text-xs text-ink">
              depuis le{" "}
              {new Date(telegramLinkedAt).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>

          <button
            onClick={handleUnlink}
            disabled={loading}
            className="text-xs text-ink hover:text-down transition-colors duration-150 disabled:opacity-50"
          >
            {loading ? "Déconnexion…" : "Délier mon Telegram"}
          </button>
        </div>
      ) : (
        // ── Non lié ──────────────────────────────────────────────────────────
        <div className="space-y-3">
          {linkOpened ? (
            <div className="text-xs text-ink bg-panel-2 border border-line rounded-xl px-4 py-3 space-y-1">
              <p className="font-medium text-ink-white">Lien Telegram ouvert ✓</p>
              <p>
                Envoyez <code className="bg-line/40 px-1 rounded">/start</code> au bot dans Telegram
                pour finaliser la liaison. La page se rechargera automatiquement.
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink">
              Liez votre compte Telegram pour recevoir chaque matin votre score et vos alertes personnalisées.
            </p>
          )}

          <button
            onClick={handleLink}
            disabled={loading || linkOpened}
            className="
              inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
              bg-gold text-bg hover:brightness-110 active:scale-95
              transition-all duration-150
              disabled:opacity-60 disabled:cursor-not-allowed
            "
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                Génération du lien…
              </>
            ) : linkOpened ? (
              "✓ Lien ouvert dans Telegram"
            ) : (
              <>
                <TelegramIcon />
                Lier mon Telegram
              </>
            )}
          </button>
        </div>
      )}

      {/* Erreur */}
      {error && (
        <p className="text-xs text-down bg-down/10 border border-down/20 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Icône Telegram inline ─────────────────────────────────────────────────────
function TelegramIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
