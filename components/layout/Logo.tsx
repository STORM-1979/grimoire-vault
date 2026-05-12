import Link from "next/link";

interface LogoProps {
  /** Kept for API compatibility with /login and /update-password
   *  pages that pass size="lg"; visual size is now driven by the
   *  text class on each call site since the icon + subtitle are
   *  gone. */
  size?: "sm" | "md" | "lg";
  /** Kept for API compatibility. */
  showText?: boolean;
}

/**
 * "g"-monogram circle + stacked wordmark + "Atelier · Personal
 * Edition" subtitle.  Restored to the original three-element
 * masthead per request after a wordmark-only pass.  Whole block
 * is a single link to /.
 */
export function Logo({ size = "md", showText = true }: LogoProps) {
  const dim = size === "sm" ? 26 : size === "lg" ? 44 : 34;
  return (
    <Link href="/" className="inline-flex items-center gap-3 group" title="На главную">
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
          <div className="font-display italic font-medium text-[22px] text-ivory tracking-tightest">
            Grimoire <span className="not-italic font-normal text-emerald-200">Vault</span>
          </div>
          <div className="font-mono text-[10px] tracking-widest uppercase text-ivory-mute mt-1.5">
            Atelier · Personal Edition
          </div>
        </div>
      )}
    </Link>
  );
}
