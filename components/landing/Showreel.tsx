"use client";
/**
 * Showreel — section interactive "Comment ça marche en action"
 * 3 étapes animées : formulaire actif → dashboard → Telegram
 * Client Component (état + animations CSS)
 */
import { useState, useEffect, useRef } from "react";

const STEPS = [
  {
    id: 1,
    label: "Ajoutez vos actifs",
    sublabel: "2 clics, zéro clé API",
  },
  {
    id: 2,
    label: "Votre score en direct",
    sublabel: "Zéro graphique agressif",
  },
  {
    id: 3,
    label: "Briefing Telegram",
    sublabel: "Chaque matin à 8h00",
  },
];

/* ── Étape 1 : simulateur d'ajout d'actif ──────────────────────────────── */
function Step1() {
  const coins = [
    { id: "BTC", name: "Bitcoin",  color: "#f7931a", letter: "₿" },
    { id: "ETH", name: "Ethereum", color: "#627eea", letter: "Ξ" },
    { id: "SOL", name: "Solana",   color: "#9945ff", letter: "◎" },
  ];
  const [selected, setSelected] = useState("BTC");
  const [amount,   setAmount]   = useState("0.5");
  const [price,    setPrice]    = useState("62 400");
  const [added,    setAdded]    = useState(false);

  const coin = coins.find((c) => c.id === selected)!;
  const val = (parseFloat(amount || "0") * parseFloat(price.replace(/\s/g, ""))).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

  function handleAdd() {
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Carte formulaire */}
      <div className="bg-panel-2 border border-line rounded-2xl p-5 space-y-4">

        {/* Sélecteur crypto */}
        <div>
          <p className="text-xs text-ink mb-2 uppercase tracking-wider font-medium">Choisissez votre crypto</p>
          <div className="flex gap-2">
            {coins.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setPrice(c.id === "BTC" ? "62 400" : c.id === "ETH" ? "3 280" : "142");
                }}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-semibold transition-all duration-200 ${
                  selected === c.id
                    ? "border-gold/60 bg-gold/10 text-ink-white"
                    : "border-line bg-panel text-ink hover:border-line/60"
                }`}
              >
                <span className="text-lg" style={{ color: selected === c.id ? c.color : "#8b95a8" }}>
                  {c.letter}
                </span>
                {c.id}
              </button>
            ))}
          </div>
        </div>

        {/* Quantité */}
        <div>
          <p className="text-xs text-ink mb-2 uppercase tracking-wider font-medium">Quantité achetée</p>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-ink-white text-sm focus:outline-none focus:border-gold/50 transition-colors"
              min="0"
              step="0.01"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink font-semibold">
              {selected}
            </span>
          </div>
        </div>

        {/* Prix d'achat */}
        <div>
          <p className="text-xs text-ink mb-2 uppercase tracking-wider font-medium">Prix d&apos;achat unitaire (€)</p>
          <div className="relative">
            <input
              type="text"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-ink-white text-sm focus:outline-none focus:border-gold/50 transition-colors"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink">€</span>
          </div>
        </div>

        {/* Valeur calculée */}
        <div className="bg-panel rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-xs text-ink">Valeur investie</span>
          <span className="text-sm font-bold text-ink-white">{val} €</span>
        </div>

        {/* Bouton ajouter */}
        <button
          onClick={handleAdd}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300 ${
            added
              ? "bg-up/20 border border-up/40 text-up"
              : "bg-gold hover:bg-amber-400 text-bg"
          }`}
        >
          {added ? "✓ Ajouté à votre portefeuille !" : `Ajouter ${coin.id}`}
        </button>

        <p className="text-center text-xs text-ink">
          Aucun compte exchange requis · Aucune clé API
        </p>
      </div>
    </div>
  );
}

/* ── Étape 2 : dashboard simplifié ─────────────────────────────────────── */
function Step2() {
  const [score, setScore] = useState(0);
  const target = 73;

  useEffect(() => {
    let frame: ReturnType<typeof setTimeout>;
    const step = () => {
      setScore((s) => {
        if (s >= target) return target;
        frame = setTimeout(step, 50);
        return s + 1;
      });
    };
    const timer = setTimeout(step, 800);
    return () => { clearTimeout(timer); clearTimeout(frame); };
  }, []);

  const positions = [
    { coin: "₿ Bitcoin",  qty: "0.5",  val: "31 200 €", pnl: "+4 800 €", pct: "+18.2%", up: true  },
    { coin: "Ξ Ethereum", qty: "2.0",  val: "6 560 €",  pnl: "-320 €",   pct: "-4.7%",  up: false },
    { coin: "◎ Solana",   qty: "12.0", val: "1 704 €",  pnl: "+244 €",   pct: "+16.7%", up: true  },
  ];

  const scoreColor =
    score >= 70 ? "#22c55e" :
    score >= 45 ? "#f5a623" : "#ef4444";

  return (
    <div className="w-full max-w-sm mx-auto space-y-3">

      {/* Score global */}
      <div className="bg-panel-2 border border-line rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-ink uppercase tracking-wider font-medium mb-1">Score de santé global</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black" style={{ color: scoreColor }}>{score}</span>
              <span className="text-lg font-bold text-ink">/100</span>
            </div>
          </div>
          <div
            className="w-16 h-16 rounded-full border-4 flex items-center justify-center text-xs font-bold"
            style={{ borderColor: scoreColor, color: scoreColor }}
          >
            {score >= 70 ? "Bon" : score >= 45 ? "Moyen" : "Risqué"}
          </div>
        </div>
        {/* Barre de progression */}
        <div className="h-2 bg-panel rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-100"
            style={{ width: `${score}%`, background: scoreColor }}
          />
        </div>
        <div className="flex justify-between text-xs text-ink mt-1.5">
          <span>P&L net total</span>
          <span className="text-up font-semibold">+4 724 €</span>
        </div>
      </div>

      {/* Tableau positions */}
      <div className="bg-panel-2 border border-line rounded-2xl overflow-hidden">
        {positions.map((p, i) => (
          <div
            key={p.coin}
            className={`flex items-center justify-between px-4 py-3 ${
              i < positions.length - 1 ? "border-b border-line" : ""
            }`}
          >
            <div>
              <p className="text-sm font-semibold text-ink-white">{p.coin}</p>
              <p className="text-xs text-ink">{p.qty} · {p.val}</p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-bold ${p.up ? "text-up" : "text-down"}`}>{p.pnl}</p>
              <p className={`text-xs ${p.up ? "text-up" : "text-down"}`}>{p.pct}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-ink">Mise à jour automatique · Prix en temps réel</p>
    </div>
  );
}

/* ── Étape 3 : mockup bulle Telegram ───────────────────────────────────── */
function Step3() {
  const lines = [
    { delay: 0,    text: "🌅 Bonjour ! Voici votre briefing crypto du matin." },
    { delay: 1600, text: "📊 Score de santé : 73/100 — Portefeuille en bonne forme." },
    { delay: 3200, text: "💰 Valeur totale : 39 464 € (+4 724 € depuis l'achat)" },
    { delay: 4800, text: "₿ Bitcoin : +18.2%  ·  Ξ Ethereum : -4.7%  ·  ◎ Solana : +16.7%" },
    { delay: 6400, text: "✅ Rien d'urgent aujourd'hui. Bonne journée !" },
  ];

  const [visible, setVisible] = useState<number[]>([]);

  useEffect(() => {
    const timers = lines.map((l, i) =>
      setTimeout(() => setVisible((v) => [...v, i]), l.delay + 400)
    );
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Faux téléphone */}
      <div className="bg-panel-2 border border-line rounded-2xl overflow-hidden">

        {/* Header Telegram */}
        <div className="bg-[#1e2535] px-4 py-3 flex items-center gap-3 border-b border-line">
          <div className="w-9 h-9 rounded-full bg-[#2AABEE]/20 border border-[#2AABEE]/30 flex items-center justify-center text-sm">
            🤖
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-white">MyChainScore Bot</p>
            <p className="text-xs text-[#2AABEE]">● en ligne</p>
          </div>
          <div className="ml-auto text-xs text-ink">08:00</div>
        </div>

        {/* Messages */}
        <div className="p-4 space-y-2 min-h-[200px] bg-[#0d1117]">
          {lines.map((l, i) => (
            <div
              key={i}
              className="transition-all duration-700"
              style={{
                opacity:   visible.includes(i) ? 1 : 0,
                transform: visible.includes(i) ? "translateY(0)" : "translateY(8px)",
              }}
            >
              <div className="inline-block bg-[#1e2535] rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[90%]">
                <p className="text-sm text-ink-white leading-relaxed">{l.text}</p>
              </div>
            </div>
          ))}

          {/* Indicateur de frappe */}
          {visible.length < lines.length && (
            <div className="flex gap-1 px-4 py-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-ink animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-line flex items-center gap-2 bg-[#161b26]">
          <div className="flex-1 bg-panel rounded-full px-4 py-2 text-xs text-ink">
            Message…
          </div>
          <div className="w-8 h-8 rounded-full bg-[#2AABEE]/20 flex items-center justify-center text-sm">
            ✈️
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-ink mt-3">
        Reçu chaque matin à 8h00 · Aucune action requise de votre part
      </p>
    </div>
  );
}

/* ── Composant principal ────────────────────────────────────────────────── */
export default function Showreel() {
  const [active, setActive] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function goTo(index: number) {
    setActive(index);
    setAnimKey((k) => k + 1);
    // Réinitialise l'auto-play
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActive((a) => {
        const next = (a + 1) % STEPS.length;
        setAnimKey((k) => k + 1);
        return next;
      });
    }, 18000);
  }

  // Auto-play au montage
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setActive((a) => {
        const next = (a + 1) % STEPS.length;
        setAnimKey((k) => k + 1);
        return next;
      });
    }, 18000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 border-t border-line">

      {/* En-tête */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-1.5 text-xs font-medium text-gold mb-5">
          Démo interactive
        </div>
        <h2 className="text-3xl font-bold text-ink-white text-balance">
          Comprendre ses cryptos en 3 étapes,{" "}
          <span className="text-gold">sans jamais connecter ses comptes.</span>
        </h2>
        <p className="mt-3 text-ink max-w-lg mx-auto">
          Voyez exactement ce que vous ferez — de l&apos;ajout de vos actifs à votre
          briefing du matin sur Telegram.
        </p>
      </div>

      {/* Layout : onglets gauche + visuel droit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">

        {/* Onglets de navigation */}
        <div className="space-y-3">
          {STEPS.map((step, i) => (
            <button
              key={step.id}
              onClick={() => goTo(i)}
              className={`w-full text-left rounded-2xl border p-5 transition-all duration-300 group ${
                active === i
                  ? "bg-panel-2 border-gold/40 shadow-lg shadow-gold/5"
                  : "bg-panel border-line hover:border-line/60"
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Numéro */}
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 transition-all duration-300 ${
                    active === i
                      ? "bg-gold text-bg"
                      : "bg-panel-2 text-ink group-hover:text-ink-light"
                  }`}
                >
                  {String(step.id).padStart(2, "0")}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm transition-colors duration-200 ${
                    active === i ? "text-ink-white" : "text-ink-light"
                  }`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-ink mt-0.5">{step.sublabel}</p>

                  {/* Barre de progression auto-play */}
                  {active === i && (
                    <div className="mt-3 h-0.5 bg-line rounded-full overflow-hidden">
                      <div
                        key={animKey}
                        className="h-full bg-gold rounded-full"
                        style={{
                          animation: "showreel-progress 18s linear forwards",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}

          {/* Keyframe injecté en style global */}
          <style>{`
            @keyframes showreel-progress {
              from { width: 0%; }
              to   { width: 100%; }
            }
          `}</style>
        </div>

        {/* Zone de visualisation */}
        <div
          key={animKey}
          className="transition-all duration-500"
          style={{
            animation: "fadeSlideIn .4s ease both",
          }}
        >
          <style>{`
            @keyframes fadeSlideIn {
              from { opacity: 0; transform: translateY(16px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {active === 0 && <Step1 />}
          {active === 1 && <Step2 key={animKey} />}
          {active === 2 && <Step3 key={animKey} />}
        </div>
      </div>
    </section>
  );
}
