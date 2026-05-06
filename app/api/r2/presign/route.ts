import { NextResponse } from "next/server";
import { presignUploadSchema } from "@/lib/schemas/r2";
import { presignUpload, validateUpload, publicUrl } from "@/lib/r2";
import { parseBody, requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, presignUploadSchema);

  const validationError = validateUpload(input.kind, input.contentType, input.contentLength, input.fileName);
  if (validationError) throw new HttpError(validationError, 400);

  const presigned = await presignUpload({
    userId: user.id,
    kind: input.kind,
    fileName: input.fileName,
    contentType: input.contentType,
    contentLength: input.contentLength,
  });

  return NextResponse.json({
    uploadUrl: presigned.url,
    key: presigned.key,
    publicUrl: publicUrl(presigned.key),
    expiresAt: presigned.expiresAt,
  });
});
