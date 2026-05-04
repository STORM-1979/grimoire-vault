import { NextResponse } from "next/server";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { getVault, deleteVault } from "@/lib/data/vaults";

/** GET /api/vaults/[id] — vault details (any member). */
export const GET = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const v = await getVault(id);
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(v);
});

/** DELETE /api/vaults/[id] — owner deletes the vault. */
export const DELETE = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await deleteVault(user.id, id);
  return NextResponse.json({ ok: true });
});
