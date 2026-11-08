"use client";
/**
 * AdminDashboard — composant client principal
 * Tabs : Vue d'ensemble | Utilisateurs | Journal
 */
import { useState, useEffect, useCallback } from "react";
import {
  Users, TrendingUp, Clock, XCircle, Euro,
  Search, RefreshCw, Fingerprint, LogOut, Trash2,
  ChevronLeft, ChevronRight, LayoutDashboard, FileText,
  CheckCircle2, AlertTriangle, Gift, Shield, LogIn
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import { signOut } from "@/app/api/auth/actions";
import type { AdminStats, ActivityLog } from "@/types/supabase";

interface AdminDashboardProps {
  adminEmail: string;
  adminName:  string | null;
}

type Tab = "overview" | "users" | "activity";

// ── Types locaux ──────────────────────────────────────────────────────────────
interface UserRow {
  id:         string;
  email:      string;
  full_name:  string | null;
  created_at: string;
  subscriptions: {
    status:             string;
    trial_end:          string | null;
    current_period_end: string | null;
  }[] | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function statusBadge(sub?: UserRow["subscriptions"]) {
  const s = sub?.[0];
  if (!s) return { label: "Aucun", color: "#6b7280", bg: "rgba(107,114,128,.12)" };

  if (s.status === "trialing") {
    const end = s.trial_end ? new Date(s.trial_end) : null;
    const expired = end && end < new Date();
    if (expired) return { label: "Essai expiré", color: "#ef4444", bg: "rgba(239,68,68,.1)" };
    return { label: "Essai", color: "#f5a623", bg: "rgba(245,166,35,.1)" };
  }
  if (s.status === "active")   return { label: "Actif",   color: "#22c55e", bg: "rgba(34,197,94,.1)" };
  if (s.status === "canceled") return { label: "Annulé",  color: "#ef4444", bg: "rgba(239,68,68,.1)" };
  if (s.status === "past_due") return { label: "Impayé",  color: "#f59e0b", bg: "rgba(245,158,11,.1)" };
  return { label: s.status, color: "#8b95a8", bg: "rgba(139,149,168,.1)" };
}

function eventLabel(type: string) {
  const map: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    signup:              { icon: <Users size={12} />,      label: "Inscription",    color: "#22c55e" },
    login:               { icon: <LogIn size={12} />,       label: "Connexion",      color: "#8b95a8" },
    oauth_login:         { icon: <Shield size={12} />,      label: "Connexion OAuth", color: "#60a5fa" },
    subscription_change: { icon: <TrendingUp size={12} />,  label: "Abonnement",     color: "#f5a623" },
    admin_action:        { icon: <Shield size={12} />,       label: "Action admin",   color: "#a78bfa" },
    passkey_reset:       { icon: <Fingerprint size={12} />, label: "Reset passkey",  color: "#f59e0b" },
    account_deleted:     { icon: <Trash2 size={12} />,      label: "Suppression",    color: "#ef4444" },
    error:               { icon: <AlertTriangle size={12} />, label: "Erreur",        color: "#ef4444" },
  };
  return map[type] ?? { icon: <FileText size={12} />, label: type, color: "#8b95a8" };
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function AdminDashboard({ adminEmail, adminName }: AdminDashboardProps) {
  const [tab, setTab] = useState<Tab>("overview");

  // Stats
  const [stats, setStats] = useState<AdminStats | null>(null);

  // Users
  const [users,    setUsers]    = useState<UserRow[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [search,   setSearch]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast,    setToast]    = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  // Activity
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Fetch stats ────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    const res = await fetch("/api/admin/stats");
    if (res.ok) setStats(await res.json());
  }, []);

  // ── Fetch users ────────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), q: search });
    const res = await fetch(`/api/admin/users?${params}`);
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      setTotal(data.total);
    }
    setLoading(false);
  }, [page, search]);

  // ── Fetch activity ─────────────────────────────────────────────────────────
  const fetchActivity = useCallback(async () => {
    const res = await fetch("/api/admin/activity?limit=50");
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (tab === "users")    fetchUsers();
    if (tab === "activity") fetchActivity();
  }, [tab, fetchUsers, fetchActivity]);

  // Re-fetch users quand search change (avec debounce)
  useEffect(() => {
    const t = setTimeout(() => { if (tab === "users") fetchUsers(); }, 400);
    return () => clearTimeout(t);
  }, [search, fetchUsers, tab]);

  // ── Action support ─────────────────────────────────────────────────────────
  const doAction = async (
    action: string,
    userId: string,
    payload?: Record<string, unknown>,
    confirm?: string
  ) => {
    if (confirm && !window.confirm(confirm)) return;
    setActionId(userId);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, userId, payload }),
    });
    setActionId(null);
    if (res.ok) {
      showToast("Action effectuée avec succès.", "ok");
      fetchUsers();
      fetchStats();
    } else {
      const d = await res.json();
      showToast(d.error ?? "Erreur", "err");
    }
  };

  const totalPages = Math.ceil(total / 20);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f1117",
      color: "#e8ecf2",
      fontFamily: "'Inter', system-ui, sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        background: "#161b26",
        borderBottom: "1px solid #2a3347",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 60,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Logo size="sm" />
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "#f5a623",
            background: "rgba(245,166,35,.1)",
            border: "1px solid rgba(245,166,35,.2)",
            borderRadius: 999,
            padding: "2px 10px",
          }}>Admin</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "#8b95a8" }}>{adminName ?? adminEmail}</span>
          <form action={signOut}>
            <button type="submit" style={{
              background: "none", border: "1px solid #2a3347", borderRadius: 8,
              color: "#8b95a8", padding: "5px 10px", cursor: "pointer", fontSize: 12,
              display: "flex", alignItems: "center", gap: 5,
              transition: "color .15s, border-color .15s",
            }}>
              <LogOut size={13} /> Déconnexion
            </button>
          </form>
        </div>
      </header>

      {/* ── Tab nav ────────────────────────────────────────────────────────── */}
      <nav style={{
        background: "#161b26",
        borderBottom: "1px solid #2a3347",
        display: "flex",
        padding: "0 24px",
        gap: 0,
      }}>
        {([
          { id: "overview",  label: "Vue d'ensemble", icon: <LayoutDashboard size={14} /> },
          { id: "users",     label: "Utilisateurs",   icon: <Users size={14} /> },
          { id: "activity",  label: "Journal",        icon: <FileText size={14} /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            height: 44,
            padding: "0 16px",
            fontSize: 13,
            fontWeight: 500,
            color: tab === t.id ? "#f5a623" : "#8b95a8",
            background: "none",
            border: "none",
            borderBottom: tab === t.id ? "2px solid #f5a623" : "2px solid transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 7,
            transition: "color .15s",
          }}>
            {t.icon}{t.label}
          </button>
        ))}
      </nav>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 100,
          background: toast.type === "ok" ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)",
          border: `1px solid ${toast.type === "ok" ? "rgba(34,197,94,.3)" : "rgba(239,68,68,.3)"}`,
          color: toast.type === "ok" ? "#22c55e" : "#ef4444",
          borderRadius: 12, padding: "10px 18px", fontSize: 13,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {toast.type === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {toast.msg}
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: "28px 24px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>

        {/* ════ TAB : VUE D'ENSEMBLE ════════════════════════════════════════ */}
        {tab === "overview" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Vue d'ensemble</h1>
              <button onClick={fetchStats} style={{
                background: "#1e2535", border: "1px solid #2a3347", borderRadius: 8,
                color: "#8b95a8", padding: "6px 12px", cursor: "pointer", fontSize: 12,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <RefreshCw size={12} /> Actualiser
              </button>
            </div>

            {/* KPI grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 32,
            }}>
              {[
                { label: "Inscrits",        value: stats?.total_users ?? "—",          icon: <Users size={18} />,       color: "#60a5fa" },
                { label: "Essais en cours", value: stats?.trialing ?? "—",             icon: <Clock size={18} />,       color: "#f5a623" },
                { label: "Abonnés actifs",  value: stats?.active ?? "—",               icon: <TrendingUp size={18} />,  color: "#22c55e" },
                { label: "MRR estimé",      value: `${stats?.mrr_estimate ?? 0} €`,    icon: <Euro size={18} />,        color: "#a78bfa" },
              ].map((kpi) => (
                <div key={kpi.label} style={{
                  background: "#161b26",
                  border: "1px solid #2a3347",
                  borderRadius: 16,
                  padding: "20px 22px",
                }}>
                  <div style={{ color: kpi.color, marginBottom: 10 }}>{kpi.icon}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.5px", fontVariantNumeric: "tabular-nums" }}>
                    {kpi.value}
                  </div>
                  <div style={{ fontSize: 12, color: "#8b95a8", marginTop: 4 }}>{kpi.label}</div>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div style={{
              background: "#161b26", border: "1px solid #2a3347", borderRadius: 16, padding: 24,
            }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 16px", color: "#a8b2c0" }}>
                Accès rapide
              </h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {[
                  { label: "Voir les utilisateurs", onClick: () => setTab("users"), icon: <Users size={13} /> },
                  { label: "Journal d'activité",    onClick: () => setTab("activity"), icon: <FileText size={13} /> },
                ].map((a) => (
                  <button key={a.label} onClick={a.onClick} style={{
                    background: "#1e2535", border: "1px solid #2a3347", borderRadius: 10,
                    color: "#e8ecf2", padding: "8px 14px", cursor: "pointer", fontSize: 13,
                    display: "flex", alignItems: "center", gap: 7, fontFamily: "inherit",
                  }}>
                    {a.icon}{a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ TAB : UTILISATEURS ═════════════════════════════════════════ */}
        {tab === "users" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
                Utilisateurs <span style={{ fontSize: 14, fontWeight: 400, color: "#8b95a8" }}>({total})</span>
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Barre de recherche */}
                <div style={{ position: "relative" }}>
                  <Search size={14} style={{
                    position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#8b95a8",
                  }} />
                  <input
                    type="search"
                    placeholder="Rechercher par email…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    style={{
                      background: "#1e2535", border: "1px solid #2a3347", borderRadius: 10,
                      color: "#e8ecf2", padding: "7px 12px 7px 32px", fontSize: 13,
                      outline: "none", width: 220, fontFamily: "inherit",
                    }}
                  />
                </div>
                <button onClick={fetchUsers} style={{
                  background: "#1e2535", border: "1px solid #2a3347", borderRadius: 8,
                  color: "#8b95a8", padding: "7px 10px", cursor: "pointer",
                }}>
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>

            {/* Table */}
            <div style={{
              background: "#161b26", border: "1px solid #2a3347", borderRadius: 16, overflow: "hidden",
            }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2a3347" }}>
                      {["Email", "Nom", "Statut", "Inscrit le", "Actions"].map((h) => (
                        <th key={h} style={{
                          padding: "12px 16px", textAlign: "left",
                          fontSize: 11, fontWeight: 600, letterSpacing: ".06em",
                          textTransform: "uppercase", color: "#8b95a8",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 32, textAlign: "center", color: "#8b95a8" }}>
                          Chargement…
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 32, textAlign: "center", color: "#8b95a8" }}>
                          {search ? "Aucun résultat pour cette recherche." : "Aucun utilisateur."}
                        </td>
                      </tr>
                    ) : (
                      users.map((u, i) => {
                        const badge = statusBadge(u.subscriptions);
                        const busy  = actionId === u.id;
                        return (
                          <tr key={u.id} style={{
                            borderBottom: i < users.length - 1 ? "1px solid #1e2535" : "none",
                            transition: "background .1s",
                          }}>
                            <td style={{ padding: "12px 16px", color: "#e8ecf2", maxWidth: 220 }}>
                              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {u.email}
                              </span>
                            </td>
                            <td style={{ padding: "12px 16px", color: "#a8b2c0" }}>
                              {u.full_name ?? <span style={{ color: "#6b7280" }}>—</span>}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <span style={{
                                fontSize: 11, fontWeight: 600,
                                color: badge.color, background: badge.bg,
                                borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap",
                              }}>{badge.label}</span>
                            </td>
                            <td style={{ padding: "12px 16px", color: "#8b95a8", whiteSpace: "nowrap" }}>
                              {fmtDate(u.created_at)}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {/* Activer */}
                                <ActionBtn
                                  icon={<CheckCircle2 size={11} />}
                                  label="Activer"
                                  color="#22c55e"
                                  disabled={busy}
                                  onClick={() => doAction("set_subscription", u.id, { status: "active" })}
                                  title="Activer l'abonnement"
                                />
                                {/* Essai +7j */}
                                <ActionBtn
                                  icon={<Gift size={11} />}
                                  label="+7j"
                                  color="#f5a623"
                                  disabled={busy}
                                  onClick={() => doAction("extend_trial", u.id, { days: 7 })}
                                  title="Prolonger l'essai de 7 jours"
                                />
                                {/* Désactiver */}
                                <ActionBtn
                                  icon={<XCircle size={11} />}
                                  label="Annuler"
                                  color="#ef4444"
                                  disabled={busy}
                                  onClick={() => doAction("set_subscription", u.id, { status: "canceled" })}
                                  title="Annuler l'abonnement"
                                />
                                {/* Reset passkeys */}
                                <ActionBtn
                                  icon={<Fingerprint size={11} />}
                                  label="Passkeys"
                                  color="#a78bfa"
                                  disabled={busy}
                                  onClick={() => doAction("reset_passkeys", u.id, undefined,
                                    `Réinitialiser les passkeys de ${u.email} ?`)}
                                  title="Supprimer les passkeys (bug d'accès)"
                                />
                                {/* Force logout */}
                                <ActionBtn
                                  icon={<LogOut size={11} />}
                                  label="Déco."
                                  color="#f59e0b"
                                  disabled={busy}
                                  onClick={() => doAction("force_signout", u.id, undefined,
                                    `Forcer la déconnexion de ${u.email} ?`)}
                                  title="Forcer la déconnexion"
                                />
                                {/* Supprimer */}
                                <ActionBtn
                                  icon={<Trash2 size={11} />}
                                  label="Suppr."
                                  color="#ef4444"
                                  disabled={busy}
                                  onClick={() => doAction("delete_user", u.id, undefined,
                                    `⚠️ Supprimer définitivement le compte de ${u.email} ?\nCette action est irréversible.`)}
                                  title="Supprimer le compte"
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{
                  borderTop: "1px solid #2a3347", padding: "12px 16px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  fontSize: 13, color: "#8b95a8",
                }}>
                  <span>Page {page} / {totalPages}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <PagBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft size={14} />
                    </PagBtn>
                    <PagBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight size={14} />
                    </PagBtn>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════ TAB : JOURNAL ═══════════════════════════════════════════════ */}
        {tab === "activity" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Journal d'activité</h1>
              <button onClick={fetchActivity} style={{
                background: "#1e2535", border: "1px solid #2a3347", borderRadius: 8,
                color: "#8b95a8", padding: "6px 12px", cursor: "pointer", fontSize: 12,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <RefreshCw size={12} /> Actualiser
              </button>
            </div>

            <div style={{ background: "#161b26", border: "1px solid #2a3347", borderRadius: 16, overflow: "hidden" }}>
              {logs.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#8b95a8" }}>Aucune activité enregistrée.</div>
              ) : logs.map((log, i) => {
                const { icon, label, color } = eventLabel(log.event_type);
                return (
                  <div key={log.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 14,
                    padding: "14px 20px",
                    borderBottom: i < logs.length - 1 ? "1px solid #1e2535" : "none",
                  }}>
                    {/* Icône type */}
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: `${color}1a`, color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginTop: 1,
                    }}>
                      {icon}
                    </div>

                    {/* Contenu */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color,
                          background: `${color}1a`, borderRadius: 999,
                          padding: "2px 8px",
                        }}>{label}</span>
                        <span style={{ fontSize: 13, color: "#a8b2c0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {log.user_email ?? "—"}
                        </span>
                      </div>
                      {log.metadata && Object.keys(log.metadata as object).length > 0 && (
                        <div style={{ fontSize: 11, color: "#8b95a8", marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>
                          {JSON.stringify(log.metadata)}
                        </div>
                      )}
                    </div>

                    {/* Date */}
                    <div style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {fmtDate(log.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

// ── Micro-composants ──────────────────────────────────────────────────────────
function ActionBtn({
  icon, label, color, disabled, onClick, title,
}: {
  icon: React.ReactNode; label: string; color: string;
  disabled: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: `${color}12`,
        border: `1px solid ${color}30`,
        borderRadius: 7,
        color,
        padding: "4px 8px",
        fontSize: 11,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? .5 : 1,
        display: "flex", alignItems: "center", gap: 4,
        fontFamily: "inherit", whiteSpace: "nowrap",
        transition: "opacity .15s",
      }}
    >
      {icon}{label}
    </button>
  );
}

function PagBtn({ children, disabled, onClick }: {
  children: React.ReactNode; disabled: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: "#1e2535", border: "1px solid #2a3347", borderRadius: 7,
      color: disabled ? "#3d4d66" : "#a8b2c0",
      padding: "5px 8px", cursor: disabled ? "not-allowed" : "pointer",
    }}>
      {children}
    </button>
  );
}
