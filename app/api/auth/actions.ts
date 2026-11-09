"use server";
/**
 * Server Actions d'authentification
 * - Email / password (signIn, signUp, signOut)
 * - OAuth (signInWithOAuth) → Google, GitHub, Apple
 * - Routage admin intelligent (ADMIN_EMAIL + rôle DB via service_role)
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import type { Provider } from "@supabase/supabase-js";

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";
const APP_URL      = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL ?? "";

// Alerte immédiate au démarrage si ADMIN_EMAIL n'est pas défini sur Vercel
// → visible dans les logs Vercel Functions dès le premier appel à actions.ts
if (!ADMIN_EMAIL) {
  console.warn(
    "[auth/actions] ⚠️  ADMIN_EMAIL est vide ou manquant. " +
    "L'admin sera redirigé vers /register/checkout au lieu de /admin. " +
    "Configure cette variable dans Vercel → Settings → Environment Variables."
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function translateAuthError(message: string): string {
  const map: Record<string, string> = {
    "Invalid login credentials":          "Email ou mot de passe incorrect.",
    "Email not confirmed":                 "Ton email n'est pas encore confirmé. Vérifie ta boîte mail.",
    "Too many requests":                   "Trop de tentatives. Attends quelques minutes avant de réessayer.",
    "User already registered":             "Cet email est déjà utilisé. Essaie de te connecter.",
    "Password should be at least 6 characters": "Le mot de passe doit faire au moins 8 caractères.",
    "Email rate limit exceeded":           "Trop d'emails envoyés. Réessaie dans une heure.",
  };
  return map[message] ?? "Erreur de connexion. Réessaie.";
}

/** Vérifie si l'utilisateur a un abonnement actif ou en essai */
async function hasActiveSubscription(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.status === "trialing" || data?.status === "active";
}

/** Détermine où rediriger après connexion selon le rôle et le statut d'abonnement */
async function getPostLoginRedirect(userId: string, email: string): Promise<string> {
  // ── DIAGNOSTIC BLOC — logs exhaustifs pour Vercel Functions ────────────────
  const rawAdminEmail = process.env.ADMIN_EMAIL;
  const adminEmailTrimmed = (rawAdminEmail ?? "").trim();
  const emailTrimmed = email.trim();

  console.log("[auth/actions][diag] ─────────────────────────────────────────");
  console.log(`[auth/actions][diag] email reçu         : "${email}"`);
  console.log(`[auth/actions][diag] email.trim()       : "${emailTrimmed}"`);
  console.log(`[auth/actions][diag] ADMIN_EMAIL raw     : ${rawAdminEmail === undefined ? "UNDEFINED (variable absente sur Vercel)" : `"${rawAdminEmail}"`}`);
  console.log(`[auth/actions][diag] ADMIN_EMAIL.trim()  : "${adminEmailTrimmed}"`);
  console.log(`[auth/actions][diag] match (strict)      : ${email === rawAdminEmail}`);
  console.log(`[auth/actions][diag] match (trim)        : ${emailTrimmed === adminEmailTrimmed}`);
  console.log("[auth/actions][diag] ─────────────────────────────────────────");

  // 1. Admin → /admin
  //    Comparaison avec trim() pour neutraliser espaces invisibles.
  //    Court-circuit ABSOLU : on retourne /admin sans aucune condition DB.
  if (adminEmailTrimmed && emailTrimmed === adminEmailTrimmed) {
    console.log(`[auth/actions] ✅ Admin identifié par email — redirection /admin forcée`);

    // Lecture DB pour le log uniquement (n'affecte PAS la redirection)
    try {
      const serviceSupabase = await createServiceClient();
      const { data, error } = await serviceSupabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      if (error) {
        console.warn(`[auth/actions][diag] Profil DB illisible (${error.message}) — redirection /admin quand même`);
      } else {
        console.log(`[auth/actions][diag] Profil DB lu — role="${data?.role ?? "null"}"`);
      }
    } catch (err) {
      console.warn("[auth/actions][diag] Exception lecture DB :", err);
    }

    return "/admin"; // ← ABSOLU : jamais de checkout pour l'admin
  }

  // 2. Utilisateur avec abonnement actif/essai → app principale
  const active = await hasActiveSubscription(userId);
  if (active) return MAIN_APP_URL;

  // 3. Pas d'abonnement actif → tunnel checkout
  return "/register/checkout";
}

// ── Connexion email/password ───────────────────────────────────────────────────
export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const email    = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) return { error: "Email et mot de passe requis." };

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: translateAuthError(error.message) };

  await logActivity({
    event_type: "login",
    user_id:    data.user.id,
    user_email: data.user.email,
    metadata:   { method: "password" },
  });

  revalidatePath("/", "layout");
  const dest = await getPostLoginRedirect(data.user.id, data.user.email ?? "");
  redirect(dest);
}

// ── Inscription ────────────────────────────────────────────────────────────────
export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const email    = formData.get("email") as string;
  const password = formData.get("password") as string;
  const fullName = (formData.get("full_name") as string) || null;

  if (!email || !password) return { error: "Email et mot de passe requis." };
  if (password.length < 8)  return { error: "Le mot de passe doit contenir au moins 8 caractères." };

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${APP_URL}/auth/callback`,
    },
  });

  if (error) return { error: translateAuthError(error.message) };

  if (data.user) {
    await logActivity({
      event_type: "signup",
      user_id:    data.user.id,
      user_email: data.user.email,
      metadata:   { method: "email" },
    });
  }

  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/register/checkout");
  }

  return { success: true, message: "Un email de confirmation t'a été envoyé. Vérifie ta boîte mail." };
}

// ── OAuth (Google / GitHub / Apple) ───────────────────────────────────────────
export async function signInWithOAuth(provider: Provider) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${APP_URL}/auth/callback`,
      // Scopes utiles pour chaque provider
      scopes: provider === "google" ? "email profile" : undefined,
    },
  });

  if (error) return { error: "Impossible de démarrer la connexion OAuth. Réessaie." };

  // Redirige vers l'URL OAuth du provider (gérée côté client)
  if (data.url) redirect(data.url);
}

// ── Déconnexion ────────────────────────────────────────────────────────────────
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
