/**
 * POST /api/telegram/request-link
 *
 * Génère un token aléatoire à usage unique (TTL 15 min) et le stocke
 * dans profiles.telegram_link_token / telegram_token_expires.
 *
 * Retourne le lien t.me/BOT?start=TOKEN que le client affiche à l'utilisateur.
 * Le token n'expose jamais l'user_id Supabase en clair.
 *
 * Sécurité :
 * - Session Supabase obligatoire (cookie httpOnly)
 * - Token 32 octets cryptographiquement aléatoires (hex 64 chars)
 * - Expiration 15 minutes
 * - Usage unique : supprimé par le webhook dès réception
 */
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "";

export async function POST() {
  // ── 1. Vérification de session ──────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  if (!BOT_USERNAME) {
    console.error("[telegram/request-link] TELEGRAM_BOT_USERNAME manquant");
    return NextResponse.json(
      { error: "Bot Telegram non configuré" },
      { status: 500 }
    );
  }

  // ── 2. Génération du token ───────────────────────────────────────────────────
  const token = randomBytes(32).toString("hex"); // 64 chars hex
  const expires = new Date(Date.now() + 15 * 60 * 1000); // +15 minutes

  // ── 3. Stockage en DB (service_role pour contourner la RLS en écriture ciblée)
  const service = await createServiceClient();
  const { error: updateError } = await service
    .from("profiles")
    .update({
      telegram_link_token: token,
      telegram_token_expires: expires.toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("[telegram/request-link] Erreur DB :", updateError.message);
    return NextResponse.json(
      { error: "Erreur interne" },
      { status: 500 }
    );
  }

  // ── 4. Retourne le lien deep-link Telegram ──────────────────────────────────
  const telegramLink = `https://t.me/${BOT_USERNAME}?start=${token}`;

  return NextResponse.json({
    link: telegramLink,
    expires_at: expires.toISOString(),
  });
}
