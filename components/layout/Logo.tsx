import Link from "next/link";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function Logo({ size = "md", showText = true }: LogoProps) {
  const dim = size === "sm" ? 26 : size === "lg" ? 44 : 34;
  return (
    <Link href="/" className="inline-flex items-center gap-3 group">
      <svg width={dim} height={dim} viewBox="0 0 34 34" aria-hidden="true">
        <circle
          cx="17" cy="17" r="16"
          fill="none" stroke="var(--color-gold)" strokeWidth="1"
          className="transition-stroke group-hover:stroke-gold-soft"
        />
        <text
          x="17" y="22.5"
          fontFamily="var(--font-fraunces), serif"
          fontStyle="italic"
          fontWeight="500"
          fontSize="18"
          textAnchor="middle"
          fill="var(--color-ivory)"
        >g</text>
      </svg>
      {showText && (
        <div className="leading-none">
          <div className="font-display italic font-medium text-[20px] text-ivory tracking-tightest">
            Grimoire <span className="not-italic font-normal text-emerald-200">Vault</span>
          </div>
          <div className="font-mono text-[10px] tracking-widest uppercase text-ivory-mute mt-1">
            Atelier · Personal Edition
          </div>
        </div>
      )}
    </Link>
  );
}
