"use client";
/**
 * Bouton d'authentification biométrique (WebAuthn / Passkeys)
 * Détecte la disponibilité côté client et masque le bouton si non supporté.
 */
import { useState, useEffect } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import {
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

interface Props {
  email?: string;
  onSuccess: (redirectUrl: string) => void;
  onError: (message: string) => void;
}

export default function BiometricButton({ email, onSuccess, onError }: Props) {
  const [supported, setSupported] = useState(false);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    // Vérifie si le navigateur supporte WebAuthn
    setSupported(browserSupportsWebAuthn());
  }, []);

  if (!supported) return null;

  const handleBiometric = async () => {
    setLoading(true);
    onError(""); // Reset erreur précédente

    try {
      // 1. Demander un challenge au serveur
      const optionsRes = await fetch("/api/webauthn/authenticate/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email || undefined }),
      });

      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error ?? "Impossible de démarrer l'authentification.");
      }

      const options = await optionsRes.json();

      // 2. Invoquer l'API biométrique du navigateur (Face ID / Touch ID / Windows Hello)
      const authResponse = await startAuthentication(options);

      // 3. Envoyer la réponse au serveur pour vérification
      const verifyRes = await fetch("/api/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResponse),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error ?? "Authentification biométrique échouée.");
      }

      const result = await verifyRes.json();

      if (result.verified && result.token && result.email) {
        // 4. Échanger le token contre une session Supabase
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();

        const { error: sessionError } = await supabase.auth.verifyOtp({
          email: result.email,
          token: result.token,
          type: "magiclink",
        });

        if (sessionError) {
          throw new Error("Impossible de créer la session. Réessaie.");
        }

        onSuccess(result.redirectUrl);
      } else {
        throw new Error("Réponse serveur inattendue.");
      }
    } catch (err: unknown) {
      // Erreur annulée par l'utilisateur — pas un vrai problème
      if (err instanceof Error && err.name === "NotAllowedError") {
        onError("Authentification annulée.");
      } else if (err instanceof Error) {
        onError(err.message);
      } else {
        onError("Erreur inconnue.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-line" />
        <span className="text-ink text-xs">ou</span>
        <div className="flex-1 h-px bg-line" />
      </div>

      <button
        onClick={handleBiometric}
        disabled={loading}
        className="btn-secondary flex items-center justify-center gap-2"
        type="button"
        aria-label="Se connecter avec la biométrie"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-gold" />
        ) : (
          <Fingerprint className="w-4 h-4 text-gold" />
        )}
        <span>
          {loading ? "Vérification..." : "Connexion par empreinte / Face ID"}
        </span>
      </button>
    </div>
  );
}
