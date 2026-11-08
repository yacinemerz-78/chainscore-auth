/**
 * Middleware Next.js — Session Supabase + protection des routes
 *
 * Logique de routage :
 * - /admin/* → réservé role='admin' (vérifié via DB) + ADMIN_EMAIL
 * - Routes protégées non-admin → redirige vers /login si non connecté
 * - Routes publiques → toujours accessibles
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ADMIN_EMAIL  = process.env.ADMIN_EMAIL ?? "";
const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";

// Routes toujours accessibles sans auth
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/auth/callback",
  "/api/webauthn",
  "/api/auth",
  "/api/stripe/webhook", // le webhook Stripe n'est pas authentifié (signature HMAC)
  "/_next",
  "/favicon",
];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Rafraîchir la session (obligatoire — ne pas supprimer)
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Routes publiques — laisser passer
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return supabaseResponse;

  // ── Protection /admin ────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // Double vérification : email ET rôle en base
    const isAdminEmail = user.email === ADMIN_EMAIL;
    if (!isAdminEmail) {
      // Redirige vers l'app principale — pas un admin
      return NextResponse.redirect(MAIN_APP_URL);
    }

    // Vérification rôle en base (via service role pour bypasser RLS)
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.redirect(MAIN_APP_URL);
    }

    return supabaseResponse;
  }

  // ── Protection routes utilisateur ────────────────────────────────────────
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
