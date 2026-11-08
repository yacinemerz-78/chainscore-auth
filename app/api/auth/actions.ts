"use server";
/**
 * Server Actions d'authentification
 * - Email / password (signIn, signUp, signOut)
 * - OAuth (signInWithOAuth) → Google, GitHub, Apple
 * - Routage admin intelligent (ADMIN_EMAIL + rôle DB)
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import type { Provider } from "@supabase/supabase-js";

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";
const APP_URL      = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL ?? "";

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
  // 1. Admin → /admin (double vérification email + rôle DB)
  if (email === ADMIN_EMAIL) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (data?.role === "admin") return "/admin";
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
