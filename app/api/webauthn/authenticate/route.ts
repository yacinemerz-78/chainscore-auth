/**
 * API WebAuthn — Authentification biométrique
 *
 * POST /api/webauthn/authenticate/options  → challenge d'authentification
 * POST /api/webauthn/authenticate/verify   → vérifie et connecte l'utilisateur
 */
import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const RP_ID  = process.env.WEBAUTHN_RP_ID  ?? "localhost";
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";

export async function POST(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const isVerify = pathname.endsWith("/verify");
  return isVerify ? handleVerify(request) : handleOptions(request);
}

// ── Génère le challenge d'authentification ────────────────────────────────────
async function handleOptions(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email as string | undefined;

    const serviceClient = await createServiceClient();

    // Si un email est fourni, on récupère les clés de cet utilisateur
    // Sinon, challenge "discoverable" (l'appareil choisit la clé)
    let allowCredentials: { id: Uint8Array; type: "public-key" }[] = [];

    if (email) {
      // Trouver le user par email
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("id")
        .eq("email", email)
        .single();

      if (profile) {
        const { data: creds } = await serviceClient
          .from("webauthn_credentials")
          .select("credential_id")
          .eq("user_id", profile.id);

        allowCredentials = (creds ?? []).map((c) => ({
          id: Buffer.from(c.credential_id, "base64url"),
          type: "public-key" as const,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "preferred",
      timeout: 60_000,
    });

    // Stocker le challenge (sans user_id pour les challenges discoverables)
    await serviceClient.from("webauthn_challenges").insert({
      user_id: null,
      challenge: options.challenge,
      type: "authentication",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    return NextResponse.json(options);
  } catch (err) {
    console.error("[webauthn/authenticate/options]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ── Vérifie la réponse biométrique et connecte l'utilisateur ─────────────────
async function handleVerify(request: NextRequest) {
  try {
    const body = await request.json();
    const serviceClient = await createServiceClient();

    // Récupérer le challenge correspondant
    const { data: challengeRow } = await serviceClient
      .from("webauthn_challenges")
      .select("*")
      .eq("type", "authentication")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!challengeRow) {
      return NextResponse.json({ error: "Challenge expiré. Réessaie." }, { status: 400 });
    }

    // Trouver la clé utilisée dans notre base
    const credentialId = body.id as string;
    const { data: credential } = await serviceClient
      .from("webauthn_credentials")
      .select("*, profiles(id, email)")
      .eq("credential_id", credentialId)
      .single();

    if (!credential) {
      return NextResponse.json({ error: "Clé biométrique non reconnue." }, { status: 400 });
    }

    // Vérifier la réponse WebAuthn
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credential_id,
        publicKey: Buffer.from(credential.public_key, "base64url"),
        counter: credential.counter,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return NextResponse.json({ error: "Authentification biométrique échouée." }, { status: 400 });
    }

    // Mettre à jour le compteur anti-replay
    await serviceClient
      .from("webauthn_credentials")
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("credential_id", credentialId);

    // Supprimer le challenge utilisé
    await serviceClient
      .from("webauthn_challenges")
      .delete()
      .eq("id", challengeRow.id);

    // Créer une session Supabase pour l'utilisateur via un magic link côté serveur
    // (WebAuthn ne peut pas appeler signInWithPassword — on génère un OTP silencieux)
    const adminClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Générer un lien de connexion unique pour cet utilisateur (expire dans 1 minute)
    const profile = credential.profiles as { id: string; email: string } | null;
    if (!profile) {
      return NextResponse.json({ error: "Profil utilisateur introuvable." }, { status: 400 });
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
      options: { expiresIn: 60 },
    });

    if (linkError || !linkData.properties?.hashed_token) {
      console.error("[webauthn/authenticate/verify] generateLink error:", linkError);
      return NextResponse.json({ error: "Impossible de créer la session." }, { status: 500 });
    }

    // Retourner le token pour que le client échange le code
    return NextResponse.json({
      verified: true,
      redirectUrl: MAIN_APP_URL,
      // Le client utilisera ce token pour s'authentifier via /auth/callback
      token: linkData.properties.hashed_token,
      email: profile.email,
    });
  } catch (err) {
    console.error("[webauthn/authenticate/verify]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
