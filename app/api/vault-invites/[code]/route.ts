import { NextResponse } from "next/server";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { acceptInvite } from "@/lib/data/vaults";

/**
 * POST /api/vault-invites/[code] — accept an invite as the calling user.
 * Idempotent if you're already a member (returns the vault either way).
 */
export const POST = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const user = await requireUser();
  const { code } = await ctx.params;
  const r = await acceptInvite(user.id, code);
  return NextResponse.json(r);
});
