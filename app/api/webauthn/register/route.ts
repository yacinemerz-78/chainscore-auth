/**
 * API WebAuthn — Enregistrement d'une nouvelle clé biométrique
 *
 * POST /api/webauthn/register/options  → génère le challenge d'enregistrement
 * POST /api/webauthn/register/verify   → vérifie la réponse et sauvegarde la clé
 */
import { NextRequest, NextResponse } from "next/server";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const RP_ID   = process.env.WEBAUTHN_RP_ID   ?? "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "MyChainScore";
const ORIGIN  = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// ── POST /api/webauthn/register/options ───────────────────────────────────────
export async function POST(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const isVerify = pathname.endsWith("/verify");

  return isVerify ? handleVerify(request) : handleOptions(request);
}

async function handleOptions(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    // Récupérer les clés existantes pour les exclure (évite les doublons)
    const { data: existingCreds } = await supabase
      .from("webauthn_credentials")
      .select("credential_id")
      .eq("user_id", user.id);

    const excludeCredentials = (existingCreds ?? []).map((c) => ({
      id: c.credential_id,
      type: "public-key" as const,
    }));

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email ?? user.id,
      userDisplayName: user.user_metadata?.full_name ?? user.email ?? "Utilisateur",
      excludeCredentials,
      authenticatorSelection: {
        // Préférer les authenticators résidents (Face ID, Touch ID, Windows Hello)
        residentKey: "preferred",
        userVerification: "preferred",
      },
      timeout: 60_000,
    });

    // Stocker le challenge en base (expire dans 5 minutes)
    const serviceClient = await createServiceClient();
    await serviceClient.from("webauthn_challenges").insert({
      user_id: user.id,
      challenge: options.challenge,
      type: "registration",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    return NextResponse.json(options);
  } catch (err) {
    console.error("[webauthn/register/options]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

async function handleVerify(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const serviceClient = await createServiceClient();

    // Récupérer le dernier challenge d'enregistrement valide pour cet user
    const { data: challengeRow, error: challengeError } = await serviceClient
      .from("webauthn_challenges")
      .select("*")
      .eq("user_id", user.id)
      .eq("type", "registration")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (challengeError || !challengeRow) {
      return NextResponse.json({ error: "Challenge expiré. Réessaie." }, { status: 400 });
    }

    // Vérifier la réponse WebAuthn
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Vérification échouée." }, { status: 400 });
    }

    const { credential } = verification.registrationInfo;

    // Supprimer le challenge utilisé
    await serviceClient
      .from("webauthn_challenges")
      .delete()
      .eq("id", challengeRow.id);

    // Sauvegarder la nouvelle clé
    const deviceName = body.deviceName ?? null;
    const { error: insertError } = await serviceClient
      .from("webauthn_credentials")
      .insert({
        user_id:       user.id,
        credential_id: credential.id,
        public_key:    Buffer.from(credential.publicKey).toString("base64url"),
        counter:       credential.counter,
        device_name:   deviceName,
      });

    if (insertError) {
      console.error("[webauthn/register/verify] Insert error:", insertError);
      return NextResponse.json({ error: "Erreur sauvegarde clé." }, { status: 500 });
    }

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error("[webauthn/register/verify]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
