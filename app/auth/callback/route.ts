import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback for Supabase magic links / OAuth providers.
 * The link in email points here with ?code=… ; we exchange it
 * for a session cookie, then redirect to ?next= (or /).
 */
/**
 * Sanitise the `next` redirect target.  Prefixing `origin` already
 * blocks fully-qualified URLs (https://evil.com becomes
 * https://our.app/https://evil.com — a path), but a bare protocol-
 * relative `//evil.com` would still get joined as
 * https://our.app//evil.com, which most browsers normalise back to
 * https://evil.com.  Belt-and-suspenders: require leading "/" and
 * reject "//" / "/\".
 */
function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=missing_code`);
}
