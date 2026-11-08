import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palette MyChainScore — identique au front-end
        ink: {
          DEFAULT: "#8b95a8",
          light: "#a8b2c0",
          white: "#e8ecf2",
        },
        panel: {
          DEFAULT: "#161b26",
          2: "#1e2535",
          dark: "#0f1117",
        },
        line: "#2a3347",
        gold: "#f5a623",
        up: "#22c55e",
        down: "#ef4444",
        warn: "#f59e0b",
        bg: "#0f1117",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "grid-pattern":
          "repeating-linear-gradient(0deg,transparent,transparent 40px,rgba(42,51,71,0.3) 40px,rgba(42,51,71,0.3) 41px),repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(42,51,71,0.3) 40px,rgba(42,51,71,0.3) 41px)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        pulse: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
