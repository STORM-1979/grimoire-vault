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
 * Wordmark-only logo: "Grimoire Vault" as a single link to home.
 * The previous "g" circle + "Atelier · Personal Edition" subtitle
 * carried no information once the user is already inside the app;
 * stripping them frees space in the header and makes the brand
 * read as a clean nav landmark instead of a stacked badge.
 */
export function Logo({ size = "md" }: LogoProps) {
  // Larger on the login screen where the wordmark stands alone as
  // the page brand, smaller in the in-app header where it shares
  // space with the nav row.
  const cls = size === "lg"
    ? "text-[36px]"
    : size === "sm"
    ? "text-[18px]"
    : "text-[22px]";
  return (
    <Link
      href="/"
      className={`font-display italic font-medium ${cls} text-ivory tracking-tightest hover:text-emerald-200 transition leading-none`}
      title="На главную"
    >
      Grimoire <span className="not-italic font-normal text-emerald-200">Vault</span>
    </Link>
  );
}
