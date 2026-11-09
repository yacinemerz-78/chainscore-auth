/**
 * Tests de fumée E2E — chainscore-auth
 * Lance avec : npx playwright test e2e/smoke.spec.ts --headed
 *
 * Prérequis : npx playwright install chromium
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://chainscore-auth.vercel.app";

// ── 1. Redirections publiques ────────────────────────────────────────────────

test("/ redirige vers /login (utilisateur non connecté)", async ({ page }) => {
  const res = await page.goto(BASE + "/", { waitUntil: "networkidle" });
  expect(page.url()).toContain("/login");
});

test("/login est accessible sans auth", async ({ page }) => {
  const res = await page.goto(BASE + "/login");
  expect(res?.status()).toBe(200);
  await expect(page.locator("input[type=email]")).toBeVisible();
});

test("/register est accessible sans auth", async ({ page }) => {
  const res = await page.goto(BASE + "/register");
  expect(res?.status()).toBe(200);
});

test("/admin redirige vers /login (utilisateur non connecté)", async ({ page }) => {
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  expect(page.url()).toContain("/login");
});

// ── 2. Route API Stripe — réponse JSON valide (non connecté = 401) ───────────

test("POST /api/stripe/checkout retourne JSON valide (401 si non connecté)", async ({ request }) => {
  const res = await request.post(BASE + "/api/stripe/checkout");

  // Doit retourner du JSON (pas de parse error)
  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType).toContain("application/json");

  // Non connecté → 401
  expect(res.status()).toBe(401);

  // La réponse ne doit JAMAIS être vide (protection contre "Unexpected end of JSON input")
  const text = await res.text();
  expect(text.trim().length).toBeGreaterThan(0);
  const body = JSON.parse(text);
  expect(body).toHaveProperty("error");
  console.log("✅ /api/stripe/checkout →", res.status(), body);
});

// ── 3. Page checkout accessible après login ───────────────────────────────────

test("/register/checkout est accessible (page cliente)", async ({ page }) => {
  const res = await page.goto(BASE + "/register/checkout");
  // La page est publique (middleware ne protège que /admin et routes non listées)
  // Selon le middleware, /register est dans PUBLIC_PATHS
  expect(res?.status()).toBe(200);
  await expect(page.locator("text=30 jours")).toBeVisible({ timeout: 5000 });
});

// ── 4. Formulaire login — validation basique ─────────────────────────────────

test("Formulaire /login — champs email et password présents", async ({ page }) => {
  await page.goto(BASE + "/login");
  await expect(page.locator("input[type=email]")).toBeVisible();
  await expect(page.locator("input[type=password]")).toBeVisible();
  await expect(page.locator("button[type=submit]")).toBeVisible();
});
