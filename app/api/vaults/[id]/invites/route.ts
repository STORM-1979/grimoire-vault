import { NextResponse } from "next/server";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";
import { listInvites, createInvite, revokeInvite } from "@/lib/data/vaults";

/** GET /api/vaults/[id]/invites — owner's view of pending invites. */
export const GET = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const items = await listInvites(user.id, id);
  return NextResponse.json({ items });
});

/** POST /api/vaults/[id]/invites — mint a fresh code (rate-limited). */
export const POST = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const limited = await checkRateLimit(user.id, "vault-invite", RATE_LIMITS.vaultInvite);
  if (limited) return limited;
  const { id } = await ctx.params;
  const inv = await createInvite(user.id, id);
  return NextResponse.json(inv, { status: 201 });
});

/** DELETE /api/vaults/[id]/invites?invite=<id> — revoke. */
export const DELETE = withErrorHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await ctx.params; // ensure params resolution; vault id implicit via invite
  const inviteId = new URL(req.url).searchParams.get("invite");
  if (!inviteId) return NextResponse.json({ error: "invite query param required" }, { status: 400 });
  await revokeInvite(user.id, inviteId);
  return NextResponse.json({ ok: true });
});
