/**
 * GET /api/cron/daily-report
 *
 * Cron Vercel — déclenché chaque matin à 7h00 UTC.
 * Envoie à chaque utilisateur éligible un bilan crypto personnalisé sur Telegram.
 *
 * Critères d'éligibilité :
 *   - Abonnement Stripe actif (status "active") ou en essai valide (status "trialing")
 *   - telegram_chat_id lié dans profiles
 *   - Portefeuille non vide dans public.portfolios (colonne items JSONB)
 *
 * Les utilisateurs sans Telegram, sans abonnement valide ou avec un portefeuille
 * vide sont ignorés silencieusement (aucun message envoyé).
 *
 * Sécurité :
 *   - Vérifie Authorization: Bearer <CRON_SECRET>
 *   - Utilise exclusivement SUPABASE_SERVICE_ROLE_KEY côté serveur
 *   - TELEGRAM_BOT_TOKEN utilisé côté serveur uniquement
 *
 * Variables d'environnement requises (Vercel > chainscore-auth) :
 *   CRON_SECRET               — secret partagé avec Vercel Cron
 *   SUPABASE_SERVICE_ROLE_KEY — clé service_role Supabase (bypass RLS)
 *   NEXT_PUBLIC_SUPABASE_URL  — URL du projet Supabase
 *   TELEGRAM_BOT_TOKEN        — token du bot Telegram
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Format d'un item tel que stocké dans portfolios.items (JSONB) par portfolio-sync.js */
interface PortfolioItem {
  id: string;        // CoinGecko ID (ex: "bitcoin")
  name: string;      // Nom lisible (ex: "Bitcoin")
  symbol: string;    // Symbole (ex: "BTC")
  thumb?: string;    // URL miniature (ignorée ici)
  qty: number;       // Quantité détenue
  buyPrice: number;  // Prix d'achat dans la devise `pair`
  pair: string;      // Devise de référence (ex: "eur", "usd", "btc")
}

interface CoinGeckoPrice {
  eur: number;
  eur_24h_change?: number;
}

interface FearGreedData {
  value: number;
  classification: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const CRON_SECRET    = process.env.CRON_SECRET ?? "";
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN ?? "";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// ─── Handler principal ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── 1. Authentification ────────────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!BOT_TOKEN) {
    console.error("[cron/daily-report] TELEGRAM_BOT_TOKEN manquant");
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN manquant" }, { status: 500 });
  }

  const startTime = Date.now();
  const service   = await createServiceClient();

  // ── 2. Profils avec Telegram lié + leur abonnement Stripe ─────────────────
  const { data: profiles, error: profilesError } = await service
    .from("profiles")
    .select(`
      id,
      email,
      telegram_chat_id,
      subscriptions (
        status,
        trial_end,
        current_period_end
      )
    `)
    .not("telegram_chat_id", "is", null);

  if (profilesError) {
    console.error("[cron/daily-report] Erreur chargement profils :", profilesError.message);
    return NextResponse.json({ error: "Erreur DB profils" }, { status: 500 });
  }

  // ── 3. Filtre : abonnement actif ou essai valide ───────────────────────────
  const now = new Date();

  const eligibleProfiles = (profiles ?? []).filter((profile) => {
    const raw = (profile as Record<string, unknown>).subscriptions;
    const sub = Array.isArray(raw) ? raw[0] : raw;
    if (!sub) return false;

    const { status, trial_end, current_period_end } = sub as {
      status: string;
      trial_end: string | null;
      current_period_end: string | null;
    };

    if (status === "trialing") {
      return !trial_end || new Date(trial_end) > now;
    }
    if (status === "active") {
      return !current_period_end || new Date(current_period_end) > now;
    }
    return false;
  });

  if (eligibleProfiles.length === 0) {
    console.log("[cron/daily-report] Aucun utilisateur éligible");
    return NextResponse.json({ sent: 0, skipped: 0, reason: "Aucun utilisateur éligible" });
  }

  // ── 4. Chargement des portefeuilles (colonne items JSONB) ──────────────────
  const userIds = eligibleProfiles.map((p) => (p as Record<string, unknown>).id as string);

  const { data: portfolios, error: portfoliosError } = await service
    .from("portfolios")
    .select("user_id, items")
    .in("user_id", userIds);

  if (portfoliosError) {
    console.error("[cron/daily-report] Erreur chargement portfolios :", portfoliosError.message);
    return NextResponse.json({ error: "Erreur DB portfolios" }, { status: 500 });
  }

  // Index rapide user_id → items
  const portfolioMap = new Map<string, PortfolioItem[]>();
  for (const row of (portfolios ?? [])) {
    const p = row as { user_id: string; items: unknown };
    const items = Array.isArray(p.items) ? (p.items as PortfolioItem[]) : [];
    if (items.length > 0) {
      portfolioMap.set(p.user_id, items);
    }
    // items vide ou absent → non inséré dans la map → skip silencieux
  }

  // Utilisateurs avec un portefeuille non vide
  const usersWithPortfolio = eligibleProfiles.filter((profile) => {
    const id = (profile as Record<string, unknown>).id as string;
    return portfolioMap.has(id);
  });

  if (usersWithPortfolio.length === 0) {
    const skipped = eligibleProfiles.length;
    console.log(`[cron/daily-report] ${skipped} utilisateur(s) éligible(s) mais portefeuilles vides — rien envoyé`);
    return NextResponse.json({ sent: 0, skipped, reason: "Tous les portefeuilles sont vides" });
  }

  // ── 5. Batch CoinGecko — une seule requête pour toutes les cryptos ─────────
  const allCoinIds = Array.from(
    new Set(
      Array.from(portfolioMap.values())
        .flat()
        .map((item) => item.id)
    )
  );

  const prices = await fetchCoinGeckoPrices(allCoinIds);

  // ── 6. Fear & Greed Index (commun à tous les rapports) ────────────────────
  const fearGreed = await fetchFearGreed();

  // ── 7. Envoi personnalisé ─────────────────────────────────────────────────
  let sent    = 0;
  let skipped = eligibleProfiles.length - usersWithPortfolio.length; // déjà skippés à l'étape 4
  let errors  = 0;

  for (const profile of usersWithPortfolio) {
    const p      = profile as Record<string, unknown>;
    const chatId = p.telegram_chat_id as string;
    const userId = p.id as string;
    const items  = portfolioMap.get(userId)!;

    const message = buildPersonalizedMessage(items, prices, fearGreed);
    const ok      = await sendTelegramMessage(chatId, message);

    if (ok) {
      sent++;
      console.log(`[cron/daily-report] ✅ Rapport envoyé à ${p.email as string}`);
    } else {
      errors++;
      console.error(`[cron/daily-report] ❌ Échec Telegram pour ${p.email as string}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[cron/daily-report] ✅ Terminé — ${sent} envois, ${skipped} skips, ${errors} erreurs en ${duration}s`);

  return NextResponse.json({
    sent,
    skipped,
    errors,
    eligible: eligibleProfiles.length,
    duration_s: parseFloat(duration),
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCoinGeckoPrices(
  coinIds: string[]
): Promise<Record<string, CoinGeckoPrice>> {
  if (coinIds.length === 0) return {};
  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${coinIds.join(",")}&vs_currencies=eur&include_24hr_change=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[cron/daily-report] CoinGecko HTTP ${res.status}`);
      return {};
    }
    return (await res.json()) as Record<string, CoinGeckoPrice>;
  } catch (err) {
    console.error("[cron/daily-report] CoinGecko erreur :", err);
    return {};
  }
}

async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      value:          parseInt(data.data?.[0]?.value ?? "0", 10),
      classification: data.data?.[0]?.value_classification ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Construit le message Telegram personnalisé.
 *
 * Les items utilisent `buyPrice` (en `pair`) comme prix d'achat.
 * On convertit tout en EUR pour le rapport (seul CoinGecko EUR est disponible).
 * Si la paire d'achat n'est pas EUR, on ne peut pas calculer le P&L exact —
 * dans ce cas on affiche la valeur actuelle sans P&L.
 */
function buildPersonalizedMessage(
  items: PortfolioItem[],
  prices: Record<string, CoinGeckoPrice>,
  fearGreed: FearGreedData | null
): string {
  const dateStr = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
    year:    "numeric",
  });

  let totalValeur  = 0;
  let totalInvesti = 0;
  let canComputePnl = true;
  const lines: string[] = [];

  for (const item of items) {
    const priceData = prices[item.id];
    const priceEur  = priceData?.eur ?? null;
    const change24h = priceData?.eur_24h_change;

    if (priceEur === null) {
      lines.push(`• ${item.symbol.toUpperCase()} — prix indisponible`);
      canComputePnl = false;
      continue;
    }

    const valeurEur = item.qty * priceEur;
    totalValeur    += valeurEur;

    // P&L calculable uniquement si l'achat était en EUR
    if (item.pair === "eur" && item.buyPrice > 0) {
      totalInvesti += item.qty * item.buyPrice;
    } else {
      canComputePnl = false;
    }

    const c24Str = change24h != null
      ? ` · 24h: ${change24h >= 0 ? "+" : ""}${change24h.toFixed(1)}%`
      : "";

    lines.push(
      `• *${item.symbol.toUpperCase()}* ${formatMoney(valeurEur)}${c24Str}`
    );
  }

  const totalPnl  = canComputePnl && totalInvesti > 0 ? totalValeur - totalInvesti : null;
  const totalPct  = totalPnl !== null && totalInvesti > 0
    ? (totalPnl / totalInvesti) * 100
    : null;
  const pnlSign   = totalPnl !== null && totalPnl >= 0 ? "📈" : "📉";
  const score     = totalPct !== null ? computeScore(totalPct) : null;

  let msg = `🌅 *Bilan MyChainScore du ${dateStr}*\n\n`;
  msg    += lines.join("\n") + "\n\n";
  msg    += `💼 *Total* : ${formatMoney(totalValeur)}\n`;

  if (totalPnl !== null && totalPct !== null) {
    msg += `${pnlSign} *P&L* : ${totalPnl >= 0 ? "+" : ""}${formatMoney(totalPnl)} (${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(1)}%)\n`;
  }

  if (score !== null) {
    msg += `🏆 *Score santé* : ${score}/100\n`;
  }

  if (fearGreed) {
    const fg      = fearGreed.value;
    const fgEmoji = fg < 25 ? "😱" : fg < 45 ? "😟" : fg < 55 ? "😐" : fg < 75 ? "😊" : "🤑";
    msg += `\n${fgEmoji} *Fear & Greed* : ${fg}/100 — ${fearGreed.classification}`;
  }

  return msg;
}

/** Score de santé simplifié basé sur le P&L en % */
function computeScore(pctPnl: number): number {
  const delta = Math.min(Math.max(pctPnl * 2, -50), 50);
  return Math.round(50 + delta);
}

function formatMoney(n: number): string {
  return n.toLocaleString("fr-FR", {
    style:                "currency",
    currency:             "EUR",
    maximumFractionDigits: 0,
  });
}

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:                  chatId,
        text,
        parse_mode:               "Markdown",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[cron/daily-report] sendMessage erreur chat=${chatId} :`, err);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[cron/daily-report] sendMessage exception chat=${chatId} :`, err);
    return false;
  }
}
