"use client";
/**
 * Page d'inscription — MyChainScore Auth
 * Crée un compte → redirige vers la page de paiement Stripe (Bloc 2)
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Mail, Lock, User, CheckCircle2 } from "lucide-react";
import { signUp } from "@/app/api/auth/actions";
import Logo from "@/components/ui/Logo";

export default function RegisterPage() {
  const [isPending, startTransition] = useTransition();

  const [email,     setEmail]    = useState("");
  const [password,  setPassword] = useState("");
  const [fullName,  setFullName] = useState("");
  const [showPass,  setShowPass] = useState(false);
  const [error,     setError]    = useState<string | null>(null);
  const [success,   setSuccess]  = useState<string | null>(null);

  // Indicateur de force du mot de passe
  const passwordStrength = (() => {
    if (password.length === 0) return null;
    if (password.length < 8)   return { level: 0, label: "Trop court", color: "bg-down" };
    if (password.length < 12 && !/[A-Z]/.test(password)) return { level: 1, label: "Faible", color: "bg-warn" };
    if (/[A-Z]/.test(password) && /[0-9]/.test(password)) return { level: 3, label: "Fort", color: "bg-up" };
    return { level: 2, label: "Correct", color: "bg-gold" };
  })();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await signUp(formData);
      if (!result) return;
      if (result.error) { setError(result.error); return; }
      // Session créée immédiatement (pas de confirmation email requise) :
      // window.location.replace() AVANT tout setState — même pattern que signIn.
      if ("redirect" in result && result.redirect) {
        window.location.replace(result.redirect);
        return;
      }
      // Email de confirmation envoyé → afficher le message, pas de redirection
      if (result.success) setSuccess(result.message ?? "Vérifie ta boîte mail !");
    });
  };

  return (
    <main className="min-h-screen bg-bg bg-grid-pattern flex flex-col items-center justify-center px-4 py-12 animate-fade-in">

      {/* Halo */}
      <div
        aria-hidden
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(ellipse, #f5a623 0%, transparent 70%)" }}
      />

      <div className="w-full max-w-md animate-slide-up">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        {/* Avantages de l'essai */}
        <div className="card mb-6 bg-gold/5 border-gold/20">
          <h2 className="text-gold font-semibold text-sm mb-3 uppercase tracking-wider">
            🎁 Essai gratuit de 30 jours
          </h2>
          <ul className="space-y-2">
            {[
              "Scores automatiques pour tes cryptos",
              "Alertes Telegram quotidiennes",
              "Météo du marché simplifiée",
              "Aucun débit pendant 30 jours",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-ink-light">
                <CheckCircle2 className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink mt-3 border-t border-line pt-3">
            Après l'essai : <span className="text-ink-white font-medium">2 € / mois</span> — résiliable à tout moment.
          </p>
        </div>

        {/* Formulaire */}
        <div className="card">

          <h1 className="text-xl font-bold text-ink-white mb-6">Créer mon compte</h1>

          {error && (
            <div className="alert-error mb-5" role="alert">{error}</div>
          )}

          {success && (
            <div className="alert-success mb-5 flex items-start gap-2" role="status">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* Prénom (optionnel) */}
            <div className="space-y-1.5">
              <label htmlFor="full_name" className="text-xs font-medium text-ink-light uppercase tracking-wider">
                Prénom <span className="text-ink normal-case">(optionnel)</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink" />
                <input
                  id="full_name"
                  name="full_name"
                  type="text"
                  autoComplete="given-name"
                  placeholder="Yayou"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input-base pl-10"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-ink-light uppercase tracking-wider">
                Adresse email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="ton@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-base pl-10"
                />
              </div>
            </div>

            {/* Mot de passe */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-ink-light uppercase tracking-wider">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink" />
                <input
                  id="password"
                  name="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="8 caractères minimum"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-base pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink hover:text-ink-light transition-colors"
                  aria-label={showPass ? "Masquer" : "Afficher"}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Barre de force du mot de passe */}
              {passwordStrength && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex gap-1 flex-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          i < passwordStrength.level ? passwordStrength.color : "bg-line"
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-xs ${
                    passwordStrength.level === 3 ? "text-up" :
                    passwordStrength.level === 2 ? "text-gold" :
                    passwordStrength.level === 1 ? "text-warn" : "text-down"
                  }`}>
                    {passwordStrength.label}
                  </span>
                </div>
              )}
            </div>

            {/* CGU */}
            <p className="text-xs text-ink leading-relaxed">
              En créant un compte, tu acceptes que tes données soient utilisées uniquement
              pour te fournir le service MyChainScore. Aucune revente de données.
            </p>

            {/* Bouton */}
            <button
              type="submit"
              disabled={isPending || !email || !password || password.length < 8}
              className="btn-primary flex items-center justify-center gap-2 mt-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Création du compte...
                </>
              ) : (
                "Commencer l'essai gratuit →"
              )}
            </button>
          </form>
        </div>

        {/* Lien connexion */}
        <p className="text-center text-sm text-ink mt-6">
          Déjà un compte ?{" "}
          <Link href="/login" className="text-gold hover:text-amber-400 font-medium transition-colors">
            Se connecter
          </Link>
        </p>

      </div>
    </main>
  );
}
