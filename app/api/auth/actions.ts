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
// Retourne { redirect: string } au lieu d'appeler redirect() directement.
// Raison : redirect() dans une Server Action appelée via startTransition depuis
// un Client Component lève NEXT_REDIRECT qui est silencieusement avalé par React —
// la navigation n'a jamais lieu. Le client doit naviguer lui-même via router.push().
export async function signIn(formData: FormData): Promise<{ error: string } | { redirect: string }> {
  const supabase = await createClient();
  const email    = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) return { error: "Email et mot de passe requis." };

  console.log(`[auth/actions] signIn appelé pour "${email}"`);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.warn(`[auth/actions] signInWithPassword échoué : ${error.message}`);
    return { error: translateAuthError(error.message) };
  }

  console.log(`[auth/actions] signInWithPassword OK — user.id=${data.user.id}`);

  await logActivity({
    event_type: "login",
    user_id:    data.user.id,
    user_email: data.user.email,
    metadata:   { method: "password" },
  });

  revalidatePath("/", "layout");
  const dest = await getPostLoginRedirect(data.user.id, data.user.email ?? "");
  console.log(`[auth/actions] redirection calculée → "${dest}"`);
  // On retourne l'URL — le client appellera router.push(dest) ou window.location.href
  return { redirect: dest };
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

    // Filet de sécurité : s'assure qu'une ligne existe dans profiles même si le
    // trigger Supabase `on_auth_user_created` n'a pas tourné (schéma non appliqué,
    // projet réinitialisé, etc.). on_conflict: id → no-op si la ligne existe déjà.
    try {
      const service = await createServiceClient();
      await service.from("profiles").upsert(
        {
          id:        data.user.id,
          email:     data.user.email ?? "",
          full_name: fullName,
          role:      "user",
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
    } catch (err) {
      // Non bloquant : le trigger a peut-être déjà inséré la ligne
      console.warn("[auth/actions] upsert profiles fallback échoué :", err);
    }

    // Crée automatiquement un essai gratuit de 30 jours pour tout nouvel utilisateur.
    // ignoreDuplicates: true → no-op si une ligne existe déjà (re-inscription même email,
    // webhook Stripe qui aurait déjà tourné, etc.). Ne remplace jamais un abonnement actif.
    try {
      const service = await createServiceClient();
      const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await service.from("subscriptions").upsert(
        {
          user_id:   data.user.id,
          status:    "trialing",
          trial_end: trialEnd,
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
      console.log(`[auth/actions] ✅ Essai gratuit créé jusqu'au ${trialEnd} pour ${data.user.email}`);
    } catch (err) {
      // Non bloquant : l'essai peut déjà exister ou la table peut être indisponible
      console.warn("[auth/actions] upsert subscriptions (trial) échoué :", err);
    }
  }

  if (data.session) {
    revalidatePath("/", "layout");
    // On retourne l'URL plutôt que d'appeler redirect() directement.
    // redirect() dans une Server Action + startTransition est silencieusement
    // avalé par React, et l'ID d'action devient périmé après un redéploiement
    // ("Failed to find Server Action"). La navigation est déléguée au composant client.
    return { success: true, redirect: "/register/checkout" };
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
