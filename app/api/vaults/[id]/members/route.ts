import { NextResponse } from "next/server";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { listMembers, leaveVault, removeMember } from "@/lib/data/vaults";

/** GET /api/vaults/[id]/members — full membership list (members only). */
export const GET = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const items = await listMembers(id);
  return NextResponse.json({ items });
});

/**
 * DELETE /api/vaults/[id]/members?user=<uuid>
 *   • own user_id → leave the vault (any role except owner)
 *   • other user_id → owner kicks
 */
export const DELETE = withErrorHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const target = new URL(req.url).searchParams.get("user");
  if (!target || target === user.id) {
    await leaveVault(user.id, id);
  } else {
    await removeMember(user.id, id, target);
  }
  return NextResponse.json({ ok: true });
});
