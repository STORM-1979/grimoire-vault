import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

/** DELETE /api/tokens/[id] — revoke a PAT. */
export const DELETE = withErrorHandler(async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("personal_access_tokens")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new HttpError(error.message, 500);
  return new NextResponse(null, { status: 204 });
});
