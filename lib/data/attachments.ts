import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DataError } from "@/lib/errors";
import type { EntryAttachment } from "@/lib/types";
import type { CreateAttachmentInput, UpdateAttachmentInput } from "@/lib/schemas/attachments";

function rowToAttachment(r: Record<string, unknown>): EntryAttachment {
  return {
    id: r.id as string,
    entryId: r.entry_id as string,
    userId: r.user_id as string,
    kind: r.kind as EntryAttachment["kind"],
    url: (r.url as string) ?? null,
    caption: (r.caption as string) ?? null,
    body: (r.body as string) ?? null,
    thumbUrl: (r.thumb_url as string) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    position: r.position as number,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function listAttachments(entryId: string): Promise<EntryAttachment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entry_attachments")
    .select("*")
    .eq("entry_id", entryId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new DataError(error.message, 500);
  return (data ?? []).map(rowToAttachment);
}

export async function createAttachment(
  userId: string,
  entryId: string,
  input: CreateAttachmentInput,
): Promise<EntryAttachment> {
  const supabase = await createClient();

  // Compute next position — append at end of board.
  const { data: existing } = await supabase
    .from("entry_attachments")
    .select("position")
    .eq("entry_id", entryId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPos = ((existing?.[0]?.position as number | undefined) ?? -1) + 1;

  // Coerce undefined fields away (PostgREST hates passing undefined).
  const row: Record<string, unknown> = {
    user_id: userId,
    entry_id: entryId,
    kind: input.kind,
    position: nextPos,
    metadata: input.metadata ?? {},
  };
  if ("url" in input && input.url) row.url = input.url;
  if ("caption" in input && input.caption !== undefined) row.caption = input.caption;
  if ("body" in input && input.body !== undefined) row.body = input.body;
  if ("thumbUrl" in input && input.thumbUrl !== undefined) row.thumb_url = input.thumbUrl;

  const { data, error } = await supabase
    .from("entry_attachments")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new DataError(error.message, 500);
  return rowToAttachment(data);
}

export async function updateAttachment(id: string, input: UpdateAttachmentInput): Promise<EntryAttachment> {
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (input.url !== undefined) row.url = input.url;
  if (input.caption !== undefined) row.caption = input.caption;
  if (input.body !== undefined) row.body = input.body;
  if (input.thumbUrl !== undefined) row.thumb_url = input.thumbUrl;
  if (input.metadata !== undefined) row.metadata = input.metadata;
  if (input.position !== undefined) row.position = input.position;
  const { data, error } = await supabase
    .from("entry_attachments")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new DataError(error.message, 500);
  return rowToAttachment(data);
}

export async function deleteAttachment(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("entry_attachments").delete().eq("id", id);
  if (error) throw new DataError(error.message, 500);
}

/**
 * Persist a new ordering.  Caller passes the full list of IDs in the
 * desired order; we issue one UPDATE per id setting position to its
 * index.  Could be a single CTE in raw SQL; the per-row update is fine
 * for board sizes we'll realistically see (< 200 items).
 */
export async function reorderAttachments(entryId: string, ids: string[]): Promise<void> {
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from("entry_attachments")
      .update({ position: i })
      .eq("id", ids[i])
      .eq("entry_id", entryId);
    if (error) throw new DataError(error.message, 500);
  }
}
