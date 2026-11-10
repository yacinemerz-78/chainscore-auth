/**
 * POST /api/telegram/webhook
 *
 * Reçoit les mises à jour envoyées par l'API Telegram (setWebhook).
 * Traite uniquement les commandes /start <token>.
 *
 * Flux :
 *   1. Vérifie X-Telegram-Bot-Api-Secret-Token (401 sinon)
 *   2. Parse le body JSON Telegram
 *   3. Si message.text commence par "/start <token>" :
 *      a. Cherche le profil correspondant au token (non expiré)
 *      b. Enregistre le telegram_chat_id
 *      c. Efface le token (usage unique)
 *      d. Envoie un message de confirmation à l'utilisateur
 *   4. Toujours renvoie 200 (Telegram exige une réponse 200 rapide)
 *
 * Variables d'environnement requises :
 *   TELEGRAM_WEBHOOK_SECRET   — secret partagé avec Telegram (setWebhook secret_token)
 *   TELEGRAM_BOT_TOKEN        — token du bot (envoi de messages)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — via createServiceClient
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN ?? "";

// Telegram attend toujours un 200 — même en cas d'erreur métier.
// On logue et on renvoie 200 pour éviter les relivraisons en boucle.
function ok(msg?: string) {
  return NextResponse.json({ ok: true, msg }, { status: 200 });
}

export async function POST(req: NextRequest) {
  // ── 1. Vérification du secret Telegram ────────────────────────────────────
  if (!WEBHOOK_SECRET) {
    console.error("[telegram/webhook] TELEGRAM_WEBHOOK_SECRET manquant");
    return NextResponse.json({ error: "Non configuré" }, { status: 500 });
  }

  const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (incomingSecret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // ── 2. Parse du body ───────────────────────────────────────────────────────
  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return ok("body invalide");
  }

  const message = update?.message;
  if (!message?.text || !message?.chat?.id) {
    return ok("pas de message textuel");
  }

  const chatId = String(message.chat.id);
  const text   = message.text.trim();

  // ── 3. Traitement de /start <token> ───────────────────────────────────────
  if (!text.startsWith("/start ")) {
    // Commande inconnue — on peut répondre poliment
    await sendTelegramMessage(
      chatId,
      "👋 Ce bot envoie votre bilan crypto quotidien.\n\nPour le lier à votre compte, utilisez le bouton « Lier Telegram » depuis votre tableau de bord MyChainScore."
    );
    return ok("commande inconnue");
  }

  const token = text.slice("/start ".length).trim();

  if (!token || token.length !== 64) {
    await sendTelegramMessage(
      chatId,
      "❌ Lien invalide. Générez un nouveau lien depuis votre tableau de bord MyChainScore."
    );
    return ok("token malformé");
  }

  // ── 4. Recherche du token en DB ───────────────────────────────────────────
  const service = await createServiceClient();

  // Nettoyage opportuniste des tokens expirés
  await service.rpc("clean_expired_telegram_tokens");

  const { data: profile, error: fetchError } = await service
    .from("profiles")
    .select("id, email, telegram_chat_id, telegram_link_token, telegram_token_expires")
    .eq("telegram_link_token", token)
    .gt("telegram_token_expires", new Date().toISOString())
    .maybeSingle();

  if (fetchError) {
    console.error("[telegram/webhook] Erreur DB lookup :", fetchError.message);
    await sendTelegramMessage(chatId, "❌ Erreur interne. Réessayez dans quelques instants.");
    return ok("erreur DB");
  }

  if (!profile) {
    await sendTelegramMessage(
      chatId,
      "❌ Ce lien est expiré ou déjà utilisé.\n\nGénérez un nouveau lien depuis votre tableau de bord MyChainScore."
    );
    return ok("token introuvable ou expiré");
  }

  // ── 5. Enregistrement du chat_id + suppression du token ───────────────────
  const { error: updateError } = await service
    .from("profiles")
    .update({
      telegram_chat_id:      chatId,
      telegram_linked_at:    new Date().toISOString(),
      telegram_link_token:   null,
      telegram_token_expires: null,
    })
    .eq("id", profile.id);

  if (updateError) {
    console.error("[telegram/webhook] Erreur mise à jour profil :", updateError.message);
    await sendTelegramMessage(chatId, "❌ Erreur lors de la liaison. Réessayez.");
    return ok("erreur update");
  }

  // ── 6. Message de confirmation ────────────────────────────────────────────
  const firstName = message.from?.first_name ?? "vous";
  await sendTelegramMessage(
    chatId,
    `✅ *Telegram lié avec succès !*\n\n` +
    `Bonjour ${firstName} ! Votre compte MyChainScore est maintenant connecté.\n\n` +
    `Chaque matin à *8h00*, vous recevrez votre bilan crypto personnalisé ici.\n\n` +
    `🔗 [Accéder à votre tableau de bord](${process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app"})`
  );

  console.log(`[telegram/webhook] ✅ Telegram lié — user=${profile.email} chat_id=${chatId}`);
  return ok("liaison réussie");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!BOT_TOKEN) {
    console.error("[telegram/webhook] TELEGRAM_BOT_TOKEN manquant");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:                  chatId,
        text,
        parse_mode:               "Markdown",
        disable_web_page_preview: false,
      }),
    });
  } catch (err) {
    console.error("[telegram/webhook] Erreur envoi confirmation :", err);
  }
}

// ─── Types Telegram (subset minimal) ────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat:  { id: number; type: string };
    text?: string;
  };
}
