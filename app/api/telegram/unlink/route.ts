/**
 * POST /api/telegram/unlink
 *
 * Délie le compte Telegram de l'utilisateur connecté.
 * Remet à null : telegram_chat_id, telegram_linked_at,
 *                telegram_link_token, telegram_token_expires.
 *
 * Sécurité :
 * - Session Supabase obligatoire (cookie httpOnly)
 * - Pas de paramètre extérieur : on agit uniquement sur auth.uid()
 * - Service role utilisé côté serveur uniquement
 */
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST() {
  // ── 1. Vérification de session ──────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // ── 2. Suppression du lien Telegram via service_role ───────────────────────
  const service = await createServiceClient();
  const { error: updateError } = await service
    .from("profiles")
    .update({
      telegram_chat_id:       null,
      telegram_linked_at:     null,
      telegram_link_token:    null,
      telegram_token_expires: null,
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("[telegram/unlink] Erreur DB :", updateError.message);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }

  console.log(`[telegram/unlink] ✅ Telegram délié — user=${user.email}`);
  return NextResponse.json({ success: true });
}
