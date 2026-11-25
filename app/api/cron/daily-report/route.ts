/**
 * GET /api/cron/daily-report
 *
 * Cron Vercel — déclenché chaque matin à 7h00 UTC.
 * Envoie à chaque utilisateur éligible un bilan personnalisé :
 *   - par e-mail (Resend) — tous les abonnés actifs/trialing avec e-mail
 *   - par Telegram — uniquement ceux qui ont lié leur compte Telegram
 *
 * Critères d'éligibilité :
 *   - Abonnement Stripe actif (status "active") ou en essai valide (status "trialing")
 *   - Portefeuille non vide dans public.portfolios (colonne items JSONB)
 *
 * Skip silencieux si :
 *   - Pas d'abonnement valide
 *   - Portfolio vide ou inexistant
 *   - Aucun e-mail ni Telegram disponible
 *
 * Sécurité :
 *   - Vérifie Authorization: Bearer <CRON_SECRET>
 *   - Utilise exclusivement SUPABASE_SERVICE_ROLE_KEY côté serveur
 *   - TELEGRAM_BOT_TOKEN et RESEND_API_KEY utilisés côté serveur uniquement
 *
 * Variables d'environnement requises (Vercel > chainscore-auth > Production) :
 *   CRON_SECRET               — secret partagé avec Vercel Cron
 *   SUPABASE_SERVICE_ROLE_KEY — clé service_role Supabase (bypass RLS)
 *   NEXT_PUBLIC_SUPABASE_URL  — URL du projet Supabase
 *   RESEND_API_KEY            — clé API Resend (re_xxxx...)
 *   RESEND_FROM_EMAIL         — expéditeur (optionnel, défaut: onboarding@resend.dev)
 *   TELEGRAM_BOT_TOKEN        — token du bot Telegram (optionnel)
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Format d'un item tel que stocké dans portfolios.items (JSONB) par portfolio-sync.js */
interface PortfolioItem {
  id: string;        // CoinGecko ID (ex: "bitcoin")
  name: string;      // Nom lisible (ex: "Bitcoin")
  symbol: string;    // Symbole (ex: "BTC")
  thumb?: string;    // URL miniature
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

interface PortfolioStats {
  totalValeur: number;
  totalInvesti: number;
  canComputePnl: boolean;
  lines: Array<{ symbol: string; valeurEur: number; change24h: number | null; priceAvailable: boolean }>;
  fearGreed: FearGreedData | null;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const CRON_SECRET    = process.env.CRON_SECRET ?? "";
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_EMAIL     = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
const APP_URL        = "https://chainscore-app.vercel.app";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// ─── Handler principal ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── 1. Authentification ────────────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!RESEND_API_KEY) {
    console.error("[cron/daily-report] RESEND_API_KEY manquante");
    return NextResponse.json({ error: "RESEND_API_KEY manquante" }, { status: 500 });
  }

  const startTime = Date.now();
  const service   = await createServiceClient();
  const resend    = new Resend(RESEND_API_KEY);

  // ── 2. Profils avec e-mail + abonnement Stripe + (optionnel) Telegram ──────
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
    `);

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

  // Index rapide user_id → items (uniquement si non vide)
  const portfolioMap = new Map<string, PortfolioItem[]>();
  for (const row of (portfolios ?? [])) {
    const p = row as { user_id: string; items: unknown };
    const items = Array.isArray(p.items) ? (p.items as PortfolioItem[]) : [];
    if (items.length > 0) {
      portfolioMap.set(p.user_id, items);
    }
  }

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
    new Set(Array.from(portfolioMap.values()).flat().map((item) => item.id))
  );
  const prices = await fetchCoinGeckoPrices(allCoinIds);

  // ── 6. Fear & Greed Index (commun à tous les rapports) ────────────────────
  const fearGreed = await fetchFearGreed();

  // ── 7. Envoi personnalisé ─────────────────────────────────────────────────
  let emailSent    = 0;
  let telegramSent = 0;
  let skipped      = eligibleProfiles.length - usersWithPortfolio.length;
  let errors       = 0;

  for (const profile of usersWithPortfolio) {
    const p        = profile as Record<string, unknown>;
    const userId   = p.id as string;
    const email    = p.email as string | null;
    const chatId   = p.telegram_chat_id as string | null;
    const items    = portfolioMap.get(userId)!;
    const stats    = computeStats(items, prices, fearGreed);

    // E-mail
    if (email) {
      const html = buildEmailHtml(email, stats);
      const subject = buildEmailSubject(stats);
      try {
        const { error: emailError } = await resend.emails.send({
          from:    FROM_EMAIL,
          to:      email,
          subject,
          html,
        });
        if (emailError) {
          console.error(`[cron/daily-report] Resend erreur pour ${email} :`, emailError);
          errors++;
        } else {
          emailSent++;
          console.log(`[cron/daily-report] ✉️  E-mail envoyé à ${email}`);
        }
      } catch (err) {
        console.error(`[cron/daily-report] Resend exception pour ${email} :`, err);
        errors++;
      }
    }

    // Telegram (si lié)
    if (chatId && BOT_TOKEN) {
      const telegramMsg = buildTelegramMessage(stats);
      const ok          = await sendTelegramMessage(chatId, telegramMsg);
      if (ok) {
        telegramSent++;
        console.log(`[cron/daily-report] 📱 Telegram envoyé à ${email ?? userId}`);
      } else {
        errors++;
        console.error(`[cron/daily-report] ❌ Telegram échoué pour ${email ?? userId}`);
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[cron/daily-report] ✅ Terminé — email:${emailSent} telegram:${telegramSent} skips:${skipped} erreurs:${errors} en ${duration}s`);

  return NextResponse.json({
    email_sent:    emailSent,
    telegram_sent: telegramSent,
    skipped,
    errors,
    eligible:   eligibleProfiles.length,
    duration_s: parseFloat(duration),
  });
}

// ─── Calcul des statistiques du portefeuille ──────────────────────────────────

function computeStats(
  items: PortfolioItem[],
  prices: Record<string, CoinGeckoPrice>,
  fearGreed: FearGreedData | null
): PortfolioStats {
  let totalValeur  = 0;
  let totalInvesti = 0;
  let canComputePnl = true;
  const lines: PortfolioStats["lines"] = [];

  for (const item of items) {
    const priceData = prices[item.id];
    const priceEur  = priceData?.eur ?? null;
    const change24h = priceData?.eur_24h_change ?? null;

    if (priceEur === null) {
      lines.push({ symbol: item.symbol, valeurEur: 0, change24h: null, priceAvailable: false });
      canComputePnl = false;
      continue;
    }

    const valeurEur = item.qty * priceEur;
    totalValeur    += valeurEur;

    if (item.pair === "eur" && item.buyPrice > 0) {
      totalInvesti += item.qty * item.buyPrice;
    } else {
      canComputePnl = false;
    }

    lines.push({ symbol: item.symbol, valeurEur, change24h, priceAvailable: true });
  }

  return { totalValeur, totalInvesti, canComputePnl, lines, fearGreed };
}

// ─── Gabarit e-mail HTML ──────────────────────────────────────────────────────

function buildEmailSubject(stats: PortfolioStats): string {
  const { totalValeur, totalInvesti, canComputePnl } = stats;
  if (canComputePnl && totalInvesti > 0) {
    const pl  = totalValeur - totalInvesti;
    const pct = ((pl / totalInvesti) * 100).toFixed(1);
    const sign = pl >= 0 ? "+" : "";
    return `📊 Votre bilan crypto du jour — ${fmtMoneyEmail(totalValeur)} (${sign}${pct}%)`;
  }
  return `📊 Votre bilan crypto du jour — ${fmtMoneyEmail(totalValeur)}`;
}

function buildEmailHtml(email: string, stats: PortfolioStats): string {
  const { totalValeur, totalInvesti, canComputePnl, lines, fearGreed } = stats;
  const pnl     = canComputePnl && totalInvesti > 0 ? totalValeur - totalInvesti : null;
  const pnlPct  = pnl !== null && totalInvesti > 0 ? (pnl / totalInvesti) * 100 : null;
  const score   = pnlPct !== null ? computeHealthScore(pnlPct) : null;

  const dateStr = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // Couleurs
  const positif    = "#22c55e";
  const negatif    = "#f97316";
  const neutre     = "#94a3b8";
  const gold       = "#f59e0b";
  const bgDark     = "#0f172a";
  const bgPanel    = "#1e293b";
  const bgBorder   = "#334155";
  const textLight  = "#f1f5f9";
  const textMuted  = "#94a3b8";

  const pnlColor   = pnl === null ? neutre : pnl >= 0 ? positif : negatif;
  const pnlLabel   = pnl === null ? "" : pnl >= 0
    ? `+${fmtMoneyEmail(pnl)} (+${pnlPct!.toFixed(1)} %)`
    : `${fmtMoneyEmail(pnl)} (${pnlPct!.toFixed(1)} %)`;

  // Fear & Greed
  let fgBlock = "";
  if (fearGreed) {
    const fg = fearGreed.value;
    const fgEmoji = fg < 25 ? "🥶" : fg < 45 ? "😟" : fg < 55 ? "😐" : fg < 75 ? "🙂" : "🤩";
    const fgLabel = fg < 25 ? "Panique générale" : fg < 45 ? "Peur" : fg < 55 ? "Neutre"
      : fg < 75 ? "Optimisme" : "Euphorie totale";
    const fgAdvice = fg < 25
      ? "Tout le monde a peur. Historiquement, c'est souvent dans ces périodes que les prix sont les plus bas. Ne vendez pas sous le coup de la peur."
      : fg < 45
      ? "Le marché est frileux. Les investisseurs patients considèrent souvent ces zones comme des opportunités d'achat progressif (DCA)."
      : fg <= 55
      ? "Ni peur ni euphorie : le marché hésite. Bon moment pour analyser tranquillement les fondamentaux."
      : fg <= 75
      ? "L'ambiance est positive. Gardez la tête froide et vos objectifs de prise de profit en vue."
      : "L'ambiance est très euphorique : attention à ne pas acheter sous le coup de l'excitation. C'est dans l'euphorie que se forment les sommets.";

    fgBlock = `
      <tr><td style="padding:0 24px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${bgPanel};border:1px solid ${bgBorder};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:16px 20px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${textMuted};margin-bottom:8px;">Sentiment du marché</div>
              <div style="display:flex;align-items:center;gap:12px;">
                <span style="font-size:28px;">${fgEmoji}</span>
                <div>
                  <div style="font-size:18px;font-weight:700;color:${textLight};">${fg}/100 — ${fgLabel}</div>
                  <div style="font-size:12px;color:${textMuted};margin-top:4px;line-height:1.5;">${fgAdvice}</div>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </td></tr>`;
  }

  // Score santé
  let scoreBlock = "";
  if (score !== null) {
    const scoreEmoji = score >= 75 ? "☀️" : score >= 50 ? "⛅" : "🌩️";
    const scoreLabel = score >= 75 ? "Grand beau temps" : score >= 50 ? "Ciel variable" : "Avis de tempête";
    const scoreColor = score >= 75 ? positif : score >= 50 ? gold : negatif;
    scoreBlock = `
      <tr><td style="padding:0 24px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${bgPanel};border:1px solid ${bgBorder};border-radius:12px;">
          <tr>
            <td style="padding:16px 20px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${textMuted};margin-bottom:8px;">Équilibre de mon portefeuille</div>
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="font-size:28px;">${scoreEmoji}</span>
                  <span style="font-size:28px;font-weight:700;font-family:monospace;color:${textLight};">${score}<span style="font-size:14px;color:${textMuted};">/100</span></span>
                </div>
                <span style="font-weight:600;color:${scoreColor};">${scoreLabel}</span>
              </div>
            </td>
          </tr>
        </table>
      </td></tr>`;
  }

  // Lignes du portefeuille
  const linesHtml = lines.map(l => {
    if (!l.priceAvailable) {
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${bgBorder};font-size:13px;color:${textLight};">${l.symbol.toUpperCase()}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${bgBorder};text-align:right;font-size:13px;color:${textMuted};">prix indisponible</td>
        <td style="padding:8px 0;border-bottom:1px solid ${bgBorder};text-align:right;"></td>
      </tr>`;
    }
    const c24Color = l.change24h === null ? textMuted : l.change24h >= 0 ? positif : negatif;
    const c24Str   = l.change24h !== null
      ? `${l.change24h >= 0 ? "+" : ""}${l.change24h.toFixed(1)} %`
      : "—";
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid ${bgBorder};font-size:13px;font-weight:600;color:${textLight};">${l.symbol.toUpperCase()}</td>
      <td style="padding:8px 0;border-bottom:1px solid ${bgBorder};text-align:right;font-size:13px;font-family:monospace;color:${textLight};">${fmtMoneyEmail(l.valeurEur)}</td>
      <td style="padding:8px 0;border-bottom:1px solid ${bgBorder};text-align:right;font-size:12px;font-family:monospace;color:${c24Color};">${c24Str}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Votre bilan crypto MyChainScore</title>
</head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:32px 0 48px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

        <!-- En-tête -->
        <tr><td style="padding:0 24px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="font-size:22px;font-weight:800;color:${textLight};">MyChainScore</div>
                <div style="font-size:13px;color:${textMuted};margin-top:4px;text-transform:capitalize;">${dateStr}</div>
              </td>
              <td align="right">
                <span style="display:inline-block;background:${gold};color:#0f172a;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;">BILAN DU JOUR</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- ═══════════════════════════════════════════════════════
             BLOC 1 — ESSENTIEL (actif)
             ═══════════════════════════════════════════════════════ -->

        <!-- Valeur totale + Gains/pertes -->
        <tr><td style="padding:0 24px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${bgDark};border:1px solid ${bgBorder};border-radius:16px;overflow:hidden;">
            <tr>
              <td width="50%" style="padding:20px 24px;border-right:1px solid ${bgBorder};">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${textMuted};margin-bottom:6px;">Ce que ça vaut aujourd'hui</div>
                <div style="font-size:26px;font-weight:800;font-family:monospace;color:${textLight};">${fmtMoneyEmail(totalValeur)}</div>
              </td>
              <td width="50%" style="padding:20px 24px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${textMuted};margin-bottom:6px;">Gains / pertes estimés</div>
                ${pnl !== null
                  ? `<div style="font-size:22px;font-weight:800;font-family:monospace;color:${pnlColor};">${pnlLabel}</div>`
                  : `<div style="font-size:14px;color:${textMuted};">Ajoutez vos prix d'achat en EUR<br>pour calculer vos gains.</div>`
                }
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Score santé -->
        ${scoreBlock}

        <!-- Sentiment du marché (Fear & Greed) -->
        ${fgBlock}

        <!-- ═══════════════════════════════════════════════════════
             DÉTAILS — Répartition par actif
             ═══════════════════════════════════════════════════════ -->
        <tr><td style="padding:0 24px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${bgPanel};border:1px solid ${bgBorder};border-radius:12px;">
            <tr>
              <td style="padding:16px 20px 4px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${textMuted};margin-bottom:12px;">Répartition</div>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <th style="text-align:left;font-size:11px;color:${textMuted};padding-bottom:8px;font-weight:500;">Actif</th>
                    <th style="text-align:right;font-size:11px;color:${textMuted};padding-bottom:8px;font-weight:500;">Valeur</th>
                    <th style="text-align:right;font-size:11px;color:${textMuted};padding-bottom:8px;font-weight:500;">24 h</th>
                  </tr>
                  ${linesHtml}
                </table>
              </td>
            </tr>
            <tr><td style="padding:12px 20px 16px;">
              <div style="font-size:11px;color:${textMuted};">
                Prix moyen payé calculé uniquement pour les positions saisies en EUR.<br>
                Les valeurs proviennent de CoinGecko et sont indicatives.
              </div>
            </td></tr>
          </table>
        </td></tr>

        <!-- ═══════════════════════════════════════════════════════
             BLOC 2 — RÉSERVÉ (désactivé, structure prête)
             Ce bloc accueillera ultérieurement un condensé
             fondamental par actif détenu (score, signal du jour).
             ═══════════════════════════════════════════════════════
        <tr><td style="padding:0 24px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e293b;border:1px dashed #334155;border-radius:12px;">
            <tr><td style="padding:20px;text-align:center;color:#475569;font-size:13px;">
              [Bloc analyse fondamentale par actif — à venir]
            </td></tr>
          </table>
        </td></tr>
        -->

        <!-- CTA -->
        <tr><td style="padding:0 24px 24px;text-align:center;">
          <a href="${APP_URL}" target="_blank"
             style="display:inline-block;background:${gold};color:#0f172a;font-weight:700;font-size:14px;padding:12px 28px;border-radius:12px;text-decoration:none;">
            Ouvrir mon tableau de bord →
          </a>
        </td></tr>

        <!-- Pied de page -->
        <tr><td style="padding:0 24px;">
          <div style="border-top:1px solid ${bgBorder};padding-top:16px;font-size:11px;color:${textMuted};text-align:center;line-height:1.6;">
            <strong style="color:${textLight};">⚠️ Pas un conseil financier.</strong> Les données sont indicatives et ne constituent pas une recommandation d'achat ou de vente.
            Investir comporte des risques de perte en capital.<br><br>
            Vous recevez cet e-mail car votre compte <strong>${email}</strong> est abonné à MyChainScore.<br>
            Gérez votre abonnement sur <a href="${APP_URL}" style="color:${gold};">chainscore-app.vercel.app</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Message Telegram (conservé, en parallèle) ───────────────────────────────

function buildTelegramMessage(stats: PortfolioStats): string {
  const { totalValeur, totalInvesti, canComputePnl, lines, fearGreed } = stats;

  const dateStr = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const pnl    = canComputePnl && totalInvesti > 0 ? totalValeur - totalInvesti : null;
  const pnlPct = pnl !== null && totalInvesti > 0 ? (pnl / totalInvesti) * 100 : null;
  const score  = pnlPct !== null ? computeHealthScore(pnlPct) : null;

  const linesStr = lines.map(l => {
    if (!l.priceAvailable) return `• ${l.symbol.toUpperCase()} — prix indisponible`;
    const c24 = l.change24h !== null
      ? ` · 24h: ${l.change24h >= 0 ? "+" : ""}${l.change24h.toFixed(1)}%`
      : "";
    return `• *${l.symbol.toUpperCase()}* ${fmtMoneyTelegram(l.valeurEur)}${c24}`;
  }).join("\n");

  let msg = `🌅 *Bilan MyChainScore du ${dateStr}*\n\n${linesStr}\n\n`;
  msg    += `💼 *Ce que ça vaut* : ${fmtMoneyTelegram(totalValeur)}\n`;

  if (pnl !== null && pnlPct !== null) {
    const sign = pnl >= 0 ? "📈 +" : "📉 ";
    msg += `${sign}*Gains/pertes* : ${fmtMoneyTelegram(pnl)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)\n`;
  }

  if (score !== null) {
    const emoji = score >= 75 ? "☀️" : score >= 50 ? "⛅" : "🌩️";
    msg += `${emoji} *Équilibre* : ${score}/100\n`;
  }

  if (fearGreed) {
    const fg      = fearGreed.value;
    const fgEmoji = fg < 25 ? "🥶" : fg < 45 ? "😟" : fg < 55 ? "😐" : fg < 75 ? "🙂" : "🤩";
    const fgLabel = fg < 25 ? "Panique" : fg < 45 ? "Peur" : fg < 55 ? "Neutre"
      : fg < 75 ? "Optimisme" : "Euphorie";
    msg += `\n${fgEmoji} *Sentiment du marché* : ${fg}/100 — ${fgLabel}`;
  }

  return msg;
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

/** Score de santé simplifié basé sur le P&L en % */
function computeHealthScore(pctPnl: number): number {
  const delta = Math.min(Math.max(pctPnl * 2, -50), 50);
  return Math.round(50 + delta);
}

function fmtMoneyEmail(n: number): string {
  return n.toLocaleString("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  });
}

function fmtMoneyTelegram(n: number): string {
  return n.toLocaleString("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
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
