/**
 * GET /api/cron/daily-report
 *
 * Cron Vercel — déclenché chaque matin à 7h00 UTC.
 * Envoie à chaque utilisateur (Telegram lié + abonnement actif)
 * un bilan crypto personnalisé basé sur son portefeuille en DB.
 *
 * Sécurité :
 * - Vérifie le header Authorization: Bearer <CRON_SECRET>
 * - N'utilise que SUPABASE_SERVICE_ROLE_KEY (jamais le client anon)
 * - TELEGRAM_BOT_TOKEN utilisé côté serveur uniquement
 *
 * Fallback :
 * - Si aucun utilisateur en DB, utilise TELEGRAM_CHAT_ID + USER_PORTFOLIO
 *   (variables d'environnement legacy, compatibilité monocompte)
 *
 * Architecture multi-tenant :
 * 1. Récupère tous les profils avec telegram_chat_id IS NOT NULL
 * 2. Filtre ceux avec abonnement actif (trialing ou active)
 * 3. Pour chaque utilisateur, charge son portefeuille depuis `portfolios`
 * 4. Batch CoinGecko : une seule requête pour toutes les cryptos uniques
 * 5. Génère et envoie le message personnalisé
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// ─── Configuration ───────────────────────────────────────────────────────────

const CRON_SECRET  = process.env.CRON_SECRET ?? "";
const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN ?? "";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// ─── Handler principal ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── 1. Authentification du cron ────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!BOT_TOKEN) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN manquant" }, { status: 500 });
  }

  const startTime = Date.now();
  const service   = await createServiceClient();

  // ── 2. Récupération des utilisateurs éligibles ─────────────────────────────
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

  // ── 3. Filtre abonnements actifs ───────────────────────────────────────────
  const now = new Date();

  type ProfileWithSub = typeof profiles extends (infer T)[] ? T : never;

  function hasActiveSubscription(profile: ProfileWithSub): boolean {
    const subs = (profile as Record<string, unknown>).subscriptions;
    if (!subs) return false;
    const sub = Array.isArray(subs) ? subs[0] : subs;
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
  }

  const eligibleProfiles = (profiles ?? []).filter(hasActiveSubscription);

  // ── 4. Fallback monocompte legacy ──────────────────────────────────────────
  if (eligibleProfiles.length === 0) {
    const legacyChatId   = process.env.TELEGRAM_CHAT_ID;
    const legacyPortfolio = process.env.USER_PORTFOLIO;

    if (legacyChatId && legacyPortfolio) {
      console.log("[cron/daily-report] Fallback monocompte legacy");
      await sendLegacyReport(legacyChatId, legacyPortfolio);
      return NextResponse.json({ sent: 1, mode: "legacy" });
    }

    return NextResponse.json({ sent: 0, reason: "Aucun utilisateur éligible" });
  }

  // ── 5. Chargement des portefeuilles ────────────────────────────────────────
  const userIds = eligibleProfiles.map((p) => (p as Record<string, unknown>).id as string);

  const { data: portfolios, error: portfoliosError } = await service
    .from("portfolios")
    .select("user_id, coin_id, coin_symbol, coin_name, qty, invested_eur")
    .in("user_id", userIds);

  if (portfoliosError) {
    console.error("[cron/daily-report] Erreur chargement portfolios :", portfoliosError.message);
    return NextResponse.json({ error: "Erreur DB portfolios" }, { status: 500 });
  }

  // ── 6. Batch CoinGecko ─────────────────────────────────────────────────────
  const coinIdSet = new Set((portfolios ?? []).map((p) => p.coin_id));
  const allCoinIds = Array.from(coinIdSet);

  let prices: Record<string, { eur: number; eur_24h_change?: number }> = {};

  if (allCoinIds.length > 0) {
    prices = await fetchCoinGeckoPrices(allCoinIds);
  }

  // ── 7. Fear & Greed Index ──────────────────────────────────────────────────
  const fearGreed = await fetchFearGreed();

  // ── 8. Envoi personnalisé par utilisateur ──────────────────────────────────
  let sent = 0;
  let errors = 0;

  for (const profile of eligibleProfiles) {
    const p = profile as Record<string, unknown>;
    const chatId   = p.telegram_chat_id as string;
    const userId   = p.id as string;
    const userPortfolio = (portfolios ?? []).filter((pos) => pos.user_id === userId);

    if (userPortfolio.length === 0) {
      // Aucune position en DB — message d'invitation
      await sendTelegramMessage(
        chatId,
        "📊 *Bilan MyChainScore*\n\n" +
        "Votre portefeuille est vide.\n\n" +
        "Ajoutez vos cryptos depuis votre tableau de bord pour recevoir votre bilan personnalisé."
      );
      sent++;
      continue;
    }

    const message = buildPersonalizedMessage(userPortfolio, prices, fearGreed);
    const ok = await sendTelegramMessage(chatId, message);
    if (ok) sent++;
    else errors++;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[cron/daily-report] ✅ ${sent} envois, ${errors} erreurs en ${duration}s`);

  return NextResponse.json({
    sent,
    errors,
    eligible: eligibleProfiles.length,
    duration_s: parseFloat(duration),
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCoinGeckoPrices(
  coinIds: string[]
): Promise<Record<string, { eur: number; eur_24h_change?: number }>> {
  try {
    const ids = coinIds.join(",");
    const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=eur&include_24hr_change=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data as Record<string, { eur: number; eur_24h_change?: number }>;
  } catch (err) {
    console.error("[cron] CoinGecko error :", err);
    return {};
  }
}

async function fetchFearGreed(): Promise<{ value: number; classification: string } | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      value: parseInt(data.data?.[0]?.value ?? "0", 10),
      classification: data.data?.[0]?.value_classification ?? "",
    };
  } catch {
    return null;
  }
}

type PortfolioRow = {
  user_id: string;
  coin_id: string;
  coin_symbol: string;
  coin_name: string;
  qty: number;
  invested_eur: number;
};

function buildPersonalizedMessage(
  portfolio: PortfolioRow[],
  prices: Record<string, { eur: number; eur_24h_change?: number }>,
  fearGreed: { value: number; classification: string } | null
): string {
  const dateStr = formatDateFR(new Date());
  let totalValeur    = 0;
  let totalInvesti   = 0;
  const lines: string[] = [];

  for (const pos of portfolio) {
    const price = prices[pos.coin_id]?.eur ?? null;
    if (price === null) {
      lines.push(`• ${pos.coin_symbol} — prix indisponible`);
      totalInvesti += pos.invested_eur;
      continue;
    }
    const valeur = pos.qty * price;
    const pnl    = valeur - pos.invested_eur;
    const pct    = pos.invested_eur > 0 ? (pnl / pos.invested_eur) * 100 : 0;
    const change24h = prices[pos.coin_id]?.eur_24h_change;

    totalValeur  += valeur;
    totalInvesti += pos.invested_eur;

    const pnlStr  = `${pnl >= 0 ? "+" : ""}${formatMoney(pnl)}`;
    const pctStr  = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    const c24     = change24h != null ? ` · 24h: ${change24h >= 0 ? "+" : ""}${change24h.toFixed(1)}%` : "";

    lines.push(`• *${pos.coin_symbol}* ${formatMoney(valeur)} (${pnlStr} / ${pctStr}${c24})`);
  }

  const totalPnl  = totalValeur - totalInvesti;
  const totalPct  = totalInvesti > 0 ? (totalPnl / totalInvesti) * 100 : 0;
  const pnlSign   = totalPnl >= 0 ? "📈" : "📉";
  const score     = computeScore(totalPct);

  let msg = `🌅 *Bilan MyChainScore du ${dateStr}*\n\n`;
  msg += lines.join("\n") + "\n\n";
  msg += `💼 *Total* : ${formatMoney(totalValeur)}\n`;
  msg += `${pnlSign} *P&L* : ${totalPnl >= 0 ? "+" : ""}${formatMoney(totalPnl)} (${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(1)}%)\n`;
  msg += `🏆 *Score santé* : ${score}/100\n`;

  if (fearGreed) {
    const fg = fearGreed.value;
    const fgEmoji = fg < 25 ? "😱" : fg < 45 ? "😟" : fg < 55 ? "😐" : fg < 75 ? "😊" : "🤑";
    msg += `\n${fgEmoji} *Fear & Greed* : ${fg}/100 — ${fearGreed.classification}`;
  }

  return msg;
}

/** Score de santé simplifié basé sur le P&L */
function computeScore(pctPnl: number): number {
  const base = 50;
  const delta = Math.min(Math.max(pctPnl * 2, -50), 50);
  return Math.round(base + delta);
}

function formatMoney(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function formatDateFR(date: Date): string {
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
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
      console.error(`[cron] sendMessage erreur chat=${chatId} :`, err);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[cron] sendMessage exception chat=${chatId} :`, err);
    return false;
  }
}

/** Fallback legacy : parse USER_PORTFOLIO (format JSON) */
async function sendLegacyReport(chatId: string, portfolioJson: string): Promise<void> {
  try {
    const portfolio: PortfolioRow[] = JSON.parse(portfolioJson);
    const coinIds = portfolio.map((p) => p.coin_id);
    const prices  = await fetchCoinGeckoPrices(coinIds);
    const fearGreed = await fetchFearGreed();
    const message = buildPersonalizedMessage(portfolio, prices, fearGreed);
    await sendTelegramMessage(chatId, message);
  } catch (err) {
    console.error("[cron/legacy] Erreur :", err);
  }
}
