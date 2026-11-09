/**
 * Middleware Next.js — Session Supabase + protection des routes
 *
 * Logique de routage :
 * - /admin/* → réservé role='admin' (vérifié via DB avec service_role) + ADMIN_EMAIL
 * - Routes protégées non-admin → redirige vers /login si non connecté
 * - Routes publiques → toujours accessibles
 *
 * Note : createServiceClient() de lib/supabase/server.ts utilise cookies() de
 * next/headers, indisponible dans le Edge Runtime du middleware. Le service client
 * est donc instancié directement ici avec SUPABASE_SERVICE_ROLE_KEY.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ADMIN_EMAIL  = process.env.ADMIN_EMAIL ?? "";
const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";

if (!ADMIN_EMAIL) {
  console.error("[middleware] ⛔ ADMIN_EMAIL manquant — /admin inaccessible pour tout le monde. Configure cette variable sur Vercel.");
}

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServerClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Parameters<typeof supabaseResponse.cookies.set>[2] }[]) {
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

    // Vérification rôle en base via service_role (bypasse la RLS)
    // createServiceClient() n'est pas utilisable ici (cookies() indisponible en Edge Runtime)
    // → on instancie directement un client service_role sans cookie management
    const serviceSupabase = createServerClient<any>(  // eslint-disable-line @typescript-eslint/no-explicit-any
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() { return []; },
          setAll() {},
        },
      }
    );

    const { data: profile, error: profileError } = await serviceSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("[middleware] Erreur lecture profil DB :", profileError.message);
      return NextResponse.redirect(MAIN_APP_URL);
    }

    if (profile?.role !== "admin") {
      console.warn(`[middleware] /admin refusé — user ${user.email} role=${profile?.role ?? "null"}`);
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
