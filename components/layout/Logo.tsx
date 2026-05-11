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
 * Two-line wordmark logo: "Grimoire" stacked over "Vault".  Italic
 * serif on top, upright accent below — reads like a magazine
 * masthead and frees horizontal space in the header.  The whole
 * block is a single link to /, no separate icon.
 */
export function Logo({ size = "md" }: LogoProps) {
  // Per-call-site sizing.  /login and /update-password pass
  // size="lg" for the page-brand position; the in-app header uses
  // the default md so the masthead doesn't dwarf the nav row.
  const top = size === "lg"
    ? "text-[36px]"
    : size === "sm"
    ? "text-[18px]"
    : "text-[22px]";
  const bottom = size === "lg"
    ? "text-[28px]"
    : size === "sm"
    ? "text-[15px]"
    : "text-[18px]";
  return (
    <Link
      href="/"
      className="group inline-block leading-[0.95] hover:opacity-90 transition"
      title="На главную"
    >
      <div className={`font-display italic font-medium ${top} text-ivory tracking-tightest`}>
        Grimoire
      </div>
      <div className={`font-display font-normal ${bottom} text-emerald-200 tracking-tightest mt-0.5`}>
        Vault
      </div>
    </Link>
  );
}
