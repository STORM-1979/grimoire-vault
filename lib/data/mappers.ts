import type { Entry, KanbanCard, CategoryId, KanbanColumn, Priority, ImportedVia } from "@/lib/types";

/** Postgres row → Entry (camelCase). Forgiving toward missing fields. */
export function rowToEntry(r: Record<string, unknown>): Entry {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    categoryId: r.category_id as CategoryId,
    title: r.title as string,
    description: (r.description as string) ?? null,
    body: (r.body as string) ?? null,
    url: (r.url as string) ?? null,
    thumbUrl: (r.thumb_url as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    duration: (r.duration as string) ?? null,
    sizeBytes: r.size_bytes !== null && r.size_bytes !== undefined ? Number(r.size_bytes) : null,
    sizeLabel: (r.size_label as string) ?? null,
    fileCount: r.file_count !== null && r.file_count !== undefined ? (r.file_count as number) : null,
    sourcePath: (r.source_path as string) ?? null,
    extractedText: (r.extracted_text as string) ?? null,
    aiSummary: (r.ai_summary as string) ?? null,
    contentHash: (r.content_hash as string) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    tags: (r.tags as string[]) ?? [],
    pinned: !!r.pinned,
    importedVia: ((r.imported_via as ImportedVia) ?? "web"),
    triagedAt: (r.triaged_at as string | null) ?? null,
    vaultId: (r.vault_id as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** Entry input (camelCase) → Postgres row (snake_case). */
export function entryToRow(input: Partial<Entry> & { categoryId?: CategoryId }): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.categoryId !== undefined) row.category_id = input.categoryId;
  if (input.title !== undefined) row.title = input.title;
  if (input.description !== undefined) row.description = input.description;
  if (input.body !== undefined) row.body = input.body;
  if (input.url !== undefined) row.url = input.url;
  if (input.thumbUrl !== undefined) row.thumb_url = input.thumbUrl;
  if (input.coverUrl !== undefined) row.cover_url = input.coverUrl;
  if (input.duration !== undefined) row.duration = input.duration;
  if (input.sizeBytes !== undefined) row.size_bytes = input.sizeBytes;
  if (input.sizeLabel !== undefined) row.size_label = input.sizeLabel;
  if (input.fileCount !== undefined) row.file_count = input.fileCount;
  if (input.sourcePath !== undefined) row.source_path = input.sourcePath;
  if (input.contentHash !== undefined) row.content_hash = input.contentHash;
  if (input.metadata !== undefined) row.metadata = input.metadata;
  if (input.tags !== undefined) row.tags = input.tags;
  if (input.pinned !== undefined) row.pinned = input.pinned;
  if (input.importedVia !== undefined) row.imported_via = input.importedVia;
  if ((input as { triagedAt?: string | null }).triagedAt !== undefined) {
    row.triaged_at = (input as { triagedAt?: string | null }).triagedAt;
  }
  if ((input as { vaultId?: string | null }).vaultId !== undefined) {
    row.vault_id = (input as { vaultId?: string | null }).vaultId;
  }
  // `embedding` rides on Update inputs as `number[]` — pgvector accepts the
  // JSON array form via supabase-js. Skip when undefined; explicit null clears.
  if ((input as { embedding?: number[] | null }).embedding !== undefined) {
    row.embedding = (input as { embedding?: number[] | null }).embedding;
  }
  return row;
}

/** Postgres row → KanbanCard (camelCase). */
export function rowToKanbanCard(r: Record<string, unknown>): KanbanCard {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    columnName: r.column_name as KanbanColumn,
    position: r.position as number,
    title: r.title as string,
    description: (r.description as string) ?? null,
    relatedCategory: (r.related_category as CategoryId) ?? null,
    dueDate: (r.due_date as string) ?? null,
    priority: ((r.priority as Priority) ?? "medium"),
    progress: r.progress !== null && r.progress !== undefined ? (r.progress as number) : null,
    tags: (r.tags as string[]) ?? [],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function kanbanCardToRow(input: Partial<KanbanCard>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.columnName !== undefined) row.column_name = input.columnName;
  if (input.position !== undefined) row.position = input.position;
  if (input.title !== undefined) row.title = input.title;
  if (input.description !== undefined) row.description = input.description;
  if (input.relatedCategory !== undefined) row.related_category = input.relatedCategory;
  if (input.dueDate !== undefined) row.due_date = input.dueDate;
  if (input.priority !== undefined) row.priority = input.priority;
  if (input.progress !== undefined) row.progress = input.progress;
  if (input.tags !== undefined) row.tags = input.tags;
  return row;
}
