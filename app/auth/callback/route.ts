/**
 * Route de callback — échange le code auth après :
 * - Confirmation email
 * - Connexion OAuth (Google, GitHub, Apple)
 * - Magic link WebAuthn
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL ?? "";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  const next  = searchParams.get("next") ?? "/";
  const error = searchParams.get("error");

  if (error) {
    console.error("[auth/callback]", error, searchParams.get("error_description"));
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("[auth/callback] Échange échoué:", exchangeError.message);
      return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
    }

    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      await logActivity({
        event_type: "oauth_login",
        user_id:    user.id,
        user_email: user.email,
        metadata:   { provider: user.app_metadata?.provider ?? "unknown" },
      });

      // 1. Routage admin (double vérification)
      if (user.email === ADMIN_EMAIL) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        if (profile?.role === "admin") {
          return NextResponse.redirect(`${origin}/admin`);
        }
      }

      // 2. next explicite (ex: magic link WebAuthn avec ?next=/register/checkout)
      if (next === "/register/checkout") {
        return NextResponse.redirect(`${origin}/register/checkout`);
      }

      // 3. Vérifier le statut d'abonnement
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle();

      const hasAccess =
        subscription?.status === "trialing" ||
        subscription?.status === "active";

      if (hasAccess) {
        return NextResponse.redirect(MAIN_APP_URL);
      }

      // 4. Pas d'abonnement actif → tunnel checkout
      return NextResponse.redirect(`${origin}/register/checkout`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=no_code`);
}
