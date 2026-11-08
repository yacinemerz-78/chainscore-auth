"use client";
/**
 * Page Checkout — Tunnel d'abonnement Stripe
 * Redirige vers Stripe Checkout (30 jours d'essai gratuit + 2 €/mois)
 */
import { useState } from "react";
import Logo from "@/components/ui/Logo";
import Link from "next/link";

const FEATURES = [
  "Scores automatiques pour tes cryptos",
  "Alertes Telegram quotidiennes",
  "Météo du marché simplifiée",
  "Accès complet à l'application",
  "Aucun débit pendant 30 jours",
];

export default function CheckoutPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Paramètre optionnel : ?canceled=1 quand l'utilisateur revient depuis Stripe
  const canceled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("canceled") === "1";

  async function startCheckout() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Impossible de démarrer le paiement");
      }

      // Redirection vers la Checkout Session Stripe
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh",
      background: "#0f1117",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 16px",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
          <Logo size="lg" />
        </div>

        {/* Bannière annulation (si retour depuis Stripe) */}
        {canceled && (
          <div style={{
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.2)",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 20,
            fontSize: 13,
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <span>⚠️</span>
            Paiement annulé. Tu peux réessayer à tout moment.
          </div>
        )}

        {/* Card principale */}
        <div style={{
          background: "#161b26",
          border: "1px solid #2a3347",
          borderRadius: 20,
          padding: "28px 28px 24px",
        }}>
          {/* En-tête */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🚀</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e8ecf2", margin: "0 0 6px" }}>
              Lance ton essai gratuit
            </h1>
            <p style={{ fontSize: 13.5, color: "#8b95a8", margin: 0 }}>
              30 jours offerts, sans engagement, sans paiement immédiat.
            </p>
          </div>

          {/* Features */}
          <div style={{
            background: "rgba(245,166,35,.04)",
            border: "1px solid rgba(245,166,35,.15)",
            borderRadius: 14,
            padding: "16px 18px",
            marginBottom: 20,
          }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {FEATURES.map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, color: "#a8b2c0" }}>
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="#22c55e" style={{ flexShrink: 0, marginTop: 1 }}>
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                  </svg>
                  {f}
                </li>
              ))}
            </ul>

            {/* Prix */}
            <div style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: "1px solid #2a3347",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: 12.5, color: "#8b95a8" }}>Après l'essai</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#e8ecf2" }}>
                2 € <span style={{ fontSize: 12, fontWeight: 400, color: "#8b95a8" }}>/ mois</span>
              </span>
            </div>
          </div>

          {/* Erreur */}
          {error && (
            <div style={{
              background: "rgba(239,68,68,.08)",
              border: "1px solid rgba(239,68,68,.2)",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 13,
              color: "#ef4444",
            }}>
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={startCheckout}
            disabled={loading}
            style={{
              width: "100%",
              background: loading ? "rgba(245,166,35,.5)" : "#f5a623",
              color: "#0f1117",
              fontWeight: 700,
              fontSize: 14,
              border: "none",
              borderRadius: 12,
              padding: "13px 20px",
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "background .15s",
            }}
          >
            {loading ? (
              <>
                <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(0,0,0,.2)", borderTopColor: "#0f1117", animation: "spin 0.7s linear infinite" }} />
                Redirection vers Stripe…
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
                Commencer — 30 jours gratuits
              </>
            )}
          </button>

          {/* Réassurance */}
          <p style={{ fontSize: 11.5, color: "#6b7280", textAlign: "center", margin: "12px 0 0" }}>
            Paiement sécurisé par Stripe · Résiliable à tout moment
          </p>
        </div>

        {/* Lien retour */}
        <p style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: "#8b95a8" }}>
          <Link href="/login" style={{ color: "#f5a623", textDecoration: "none" }}>
            ← Revenir à la connexion
          </Link>
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}
