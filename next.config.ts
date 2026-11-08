import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autoriser la redirection externe vers l'app principale
  async redirects() {
    return [];
  },
  // Headers de sécurité
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Autoriser la biométrie (publickey-credentials)
            value: "publickey-credentials-get=(self), publickey-credentials-create=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
