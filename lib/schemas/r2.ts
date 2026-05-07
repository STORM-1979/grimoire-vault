import { z } from "zod";

export const presignUploadSchema = z.object({
  kind: z.enum(["originals", "covers", "thumbs"]),
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(3).max(120),
  contentLength: z.number().int().min(1).max(200 * 1024 * 1024),
}).strict();

