import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyChainScore — Accès",
  description: "Connecte-toi pour accéder à ton tableau de bord crypto MyChainScore.",
  robots: { index: false, follow: false }, // Page privée — pas d'indexation
  openGraph: {
    title: "MyChainScore",
    description: "Analyse crypto simplifiée pour débutants.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f1117",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen bg-bg antialiased">
        {children}
      </body>
    </html>
  );
}
