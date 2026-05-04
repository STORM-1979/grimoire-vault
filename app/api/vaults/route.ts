import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, withErrorHandler, parseBody } from "@/lib/api-helpers";
import { listMyVaults, createVault } from "@/lib/data/vaults";

/** GET /api/vaults — list vaults the calling user belongs to. */
export const GET = withErrorHandler(async () => {
  await requireUser();
  const items = await listMyVaults();
  return NextResponse.json({ items });
});

/** POST /api/vaults — create a new shared vault. */
const createSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const { name } = await parseBody(request, createSchema);
  const v = await createVault(user.id, name);
  return NextResponse.json(v, { status: 201 });
});
