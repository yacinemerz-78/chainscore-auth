/**
 * Logo MyChainScore — Pure CSS, identique au front-end principal
 */
export default function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: { diamond: "w-6 h-6", text: "text-base", badge: "text-[9px] px-1.5 py-0.5" },
    md: { diamond: "w-8 h-8", text: "text-xl", badge: "text-[10px] px-2 py-0.5" },
    lg: { diamond: "w-10 h-10", text: "text-2xl", badge: "text-xs px-2 py-1" },
  };
  const s = sizes[size];

  return (
    <div className="flex items-center gap-3">
      {/* Diamond logo */}
      <div
        className={`${s.diamond} relative flex-shrink-0`}
        style={{
          background: "linear-gradient(135deg, #f5a623 0%, #e8921a 50%, #d4820f 100%)",
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
        >
          <span className="text-bg font-bold" style={{ fontSize: "45%" }}>M</span>
        </div>
      </div>

      {/* Texte */}
      <div className="flex flex-col leading-none">
        <span className={`${s.text} font-bold text-ink-white tracking-tight`}>
          My<span className="text-gold">Chain</span>Score
        </span>
        <span className={`${s.badge} bg-gold/10 text-gold border border-gold/20 rounded-full font-medium mt-1 w-fit`}>
          Crypto simplifié
        </span>
      </div>
    </div>
  );
}
