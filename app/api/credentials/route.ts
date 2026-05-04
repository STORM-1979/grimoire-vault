import { NextResponse } from "next/server";
import { createCredentialSchema } from "@/lib/schemas/credentials";
import { createCredential, listCredentials } from "@/lib/data/credentials";
import { parseBody, requireUser, withErrorHandler } from "@/lib/api-helpers";

export const GET = withErrorHandler(async () => {
  await requireUser();
  const items = await listCredentials();
  return NextResponse.json({ items });
});

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, createCredentialSchema);
  const cred = await createCredential(user.id, input);
  return NextResponse.json(cred, { status: 201 });
});
