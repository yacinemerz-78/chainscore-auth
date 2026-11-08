import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  use: {
    baseURL: process.env.BASE_URL ?? "https://chainscore-auth.vercel.app",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
