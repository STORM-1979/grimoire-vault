import { NextResponse } from "next/server";
import { z } from "zod";
import { updateCredentialSchema } from "@/lib/schemas/credentials";
import { deleteCredential, updateCredential } from "@/lib/data/credentials";
import { parseBody, requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PATCH = withErrorHandler(async (request: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  const input = await parseBody(request, updateCredentialSchema);
  const cred = await updateCredential(parsed.data, input);
  return NextResponse.json(cred);
});

export const DELETE = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  await deleteCredential(parsed.data);
  return new NextResponse(null, { status: 204 });
});
