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
      console.warn("[middleware] /admin — non connecté → /login");
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    console.log(`[middleware] /admin — user="${user.email}" ADMIN_EMAIL="${ADMIN_EMAIL}"`);

    // Court-circuit ABSOLU : si email === ADMIN_EMAIL (trim), on laisse passer
    // sans aucune query DB (la query DB peut échouer en Edge Runtime ou sur RLS).
    // La vérification de rôle fine est déléguée à app/admin/page.tsx.
    const adminEmailTrimmed = ADMIN_EMAIL.trim();
    const userEmailTrimmed  = (user.email ?? "").trim();

    if (adminEmailTrimmed && userEmailTrimmed === adminEmailTrimmed) {
      console.log(`[middleware] ✅ Admin email match — accès /admin accordé`);
      return supabaseResponse;
    }

    // Vérification rôle en base via service_role pour les admins sans ADMIN_EMAIL
    // (cas où le rôle est 'admin' en DB mais email différent de ADMIN_EMAIL)
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
      } else if (profile?.role === "admin") {
        console.log(`[middleware] ✅ Admin rôle DB — accès /admin accordé`);
        return supabaseResponse;
      } else {
        console.warn(`[middleware] /admin refusé — user ${user.email} role=${profile?.role ?? "null"}`);
      }
    } else {
      console.error("[middleware] ⛔ SUPABASE_SERVICE_ROLE_KEY absent — vérification DB impossible");
    }

    // Ni email admin ni rôle admin → refus
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // ── Protection routes utilisateur ────────────────────────────────────────
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // ── Vérification essai / abonnement ──────────────────────────────────────
  // On ne vérifie pas pour /register/* (checkout, confirmation…) pour éviter
  // une boucle de redirection infinie.
  const isRegisterPath = pathname.startsWith("/register");
  if (!isRegisterPath && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
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

      const { data: sub } = await serviceSupabase
        .from("subscriptions")
        .select("status, trial_end, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();

      const now = Date.now();
      const isActive   = sub?.status === "active";
      const isTrialing = sub?.status === "trialing" && sub.trial_end && new Date(sub.trial_end).getTime() > now;
      const hasAccess  = isActive || isTrialing;

      if (!hasAccess) {
        console.warn(`[middleware] ⛔ Accès bloqué — user=${user.email} status=${sub?.status ?? "none"} trial_end=${sub?.trial_end ?? "null"}`);
        const url = request.nextUrl.clone();
        url.pathname = "/register/checkout";
        return NextResponse.redirect(url);
      }
    } catch (err) {
      // En cas d'erreur DB, on laisse passer plutôt que de bloquer à tort.
      console.error("[middleware] Erreur vérification abonnement :", err);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
