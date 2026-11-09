"use client";
/**
 * Page de connexion — email/password + OAuth (Google, GitHub, Apple) + WebAuthn
 *
 * LoginPageClient est un composant client qui utilise useSearchParams().
 * Il est enveloppé dans <Suspense> par le Server Component par défaut (LoginPage)
 * pour éviter l'erreur de prerender Next.js au build.
 */
import { Suspense } from "react";
import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Mail, Lock } from "lucide-react";
import { signIn } from "@/app/api/auth/actions";
import Logo from "@/components/ui/Logo";
import BiometricButton from "@/components/ui/BiometricButton";
import OAuthButtons from "@/components/ui/OAuthButtons";

const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "https://chainscore-app.vercel.app";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageClient />
    </Suspense>
  );
}

function LoginPageClient() {
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [remember,   setRemember]   = useState(false);
  const [showPass,   setShowPass]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const err = searchParams.get("error");
    if (err === "callback_failed") setError("Lien de confirmation invalide ou expiré.");
    if (err === "exchange_failed")  setError("Erreur d'authentification. Réessaie.");
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    if (remember) formData.set("remember", "on");
    startTransition(async () => {
      const result = await signIn(formData);
      if (!result) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // Server Action retourne { redirect: dest } — on navigue côté client
      // (redirect() dans une SA appelée via startTransition lève NEXT_REDIRECT
      //  qui est silencieusement avalé par React → pas de navigation)
      setSuccessMsg("Connexion réussie ! Redirection...");
      window.location.href = result.redirect;
    });
  };

  const handleBiometricSuccess = (redirectUrl: string) => {
    setSuccessMsg("Authentification réussie ! Redirection...");
    setTimeout(() => { window.location.href = redirectUrl || MAIN_APP_URL; }, 800);
  };

  return (
    <main className="min-h-screen bg-bg bg-grid-pattern flex flex-col items-center justify-center px-4 py-12 animate-fade-in">
      <div aria-hidden className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(ellipse, #f5a623 0%, transparent 70%)" }} />

      <div className="w-full max-w-md animate-slide-up">
        <div className="flex justify-center mb-8"><Logo size="lg" /></div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-ink-white">Bon retour ! 👋</h1>
          <p className="text-ink text-sm mt-2">Connecte-toi pour accéder à ton tableau de bord crypto.</p>
        </div>

        <div className="card">
          {error && <div className="alert-error mb-5" role="alert">{error}</div>}
          {successMsg && (
            <div className="alert-success mb-5 flex items-center gap-2" role="status">
              <Loader2 className="w-4 h-4 animate-spin" />{successMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-ink-light uppercase tracking-wider">
                Adresse email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink" />
                <input id="email" name="email" type="email" autoComplete="email" required
                  placeholder="ton@email.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} className="input-base pl-10" />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-ink-light uppercase tracking-wider">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink" />
                <input id="password" name="password" type={showPass ? "text" : "password"}
                  autoComplete="current-password" required placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input-base pl-10 pr-10" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink hover:text-ink-light transition-colors"
                  aria-label={showPass ? "Masquer" : "Afficher"}>
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember + forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" name="remember" checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded border-line bg-panel-2 text-gold focus:ring-gold/30 focus:ring-1" />
                <span className="text-sm text-ink">Se souvenir de moi</span>
              </label>
              <button type="button" className="text-sm text-gold hover:text-amber-400 transition-colors">
                Mot de passe oublié ?
              </button>
            </div>

            <button type="submit" disabled={isPending || !email || !password}
              className="btn-primary flex items-center justify-center gap-2 mt-6">
              {isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" />Connexion en cours...</>
                : "Se connecter"}
            </button>
          </form>

          {/* WebAuthn */}
          <BiometricButton email={email} onSuccess={handleBiometricSuccess}
            onError={(msg) => msg && setError(msg)} />

          {/* Séparateur OAuth */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-line" />
            <span className="text-ink text-xs">ou continuer avec</span>
            <div className="flex-1 h-px bg-line" />
          </div>

          {/* OAuth buttons */}
          <OAuthButtons onError={(msg) => setError(msg)} />
        </div>

        <p className="text-center text-sm text-ink mt-6">
          Pas encore de compte ?{" "}
          <Link href="/register" className="text-gold hover:text-amber-400 font-medium transition-colors">
            Essayer gratuitement 30 jours →
          </Link>
        </p>
      </div>
    </main>
  );
}
