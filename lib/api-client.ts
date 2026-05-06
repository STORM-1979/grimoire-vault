/**
 * Typed fetch wrappers around our /api routes.
 * Used by client components and React hooks.
 */
import type { Entry, KanbanCard, KanbanColumn, CredentialRecord } from "@/lib/types";
import type { CreateEntryInput, UpdateEntryInput, ListEntriesQuery } from "@/lib/schemas/entries";
import type { CreateKanbanInput, UpdateKanbanInput, ReorderKanbanInput } from "@/lib/schemas/kanban";
import type { CreateCredentialInput, UpdateCredentialInput } from "@/lib/schemas/credentials";

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body ? (body as { error: string }).error : `HTTP ${res.status}`);
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

/* ---------- ENTRIES ---------- */
export const entriesApi = {
  list: (query: Partial<ListEntriesQuery> = {}): Promise<{ items: Entry[]; total: number }> => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    });
    return call(`/api/entries?${params.toString()}`);
  },
  get: (id: string) => call<Entry>(`/api/entries/${id}`),
  create: (input: CreateEntryInput) =>
    call<Entry>("/api/entries", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: UpdateEntryInput) =>
    call<Entry>(`/api/entries/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  delete: (id: string) =>
    call<void>(`/api/entries/${id}`, { method: "DELETE" }),
};

/* ---------- SEARCH ---------- */
export interface SearchHit {
  entry: Entry;
  rank: number;
  snippet?: string;
}
export const searchApi = {
  query: (q: string, categories?: string[], limit = 25) => {
    const params = new URLSearchParams();
    params.set("q", q);
    if (limit) params.set("limit", String(limit));
    if (categories?.length) params.set("categories", categories.join(","));
    return call<{ results: SearchHit[]; count: number; query: string; mode: "fts" }>(
      `/api/search?${params.toString()}`
    );
  },
  /**
   * Semantic / hybrid search — embedding is computed in the browser; the
   * server runs the cosine query (mode='semantic') or fuses it with FTS via
   * Reciprocal Rank Fusion (mode='hybrid', default).
   */
  semantic: (input: {
    q: string;
    embedding: number[];
    categories?: string[];
    limit?: number;
    threshold?: number;
    mode?: "semantic" | "hybrid";
  }) =>
    call<{ results: SearchHit[]; count: number; query: string; mode: "semantic" | "hybrid" }>(
      "/api/search",
      { method: "POST", body: JSON.stringify(input) }
    ),
};

/* ---------- CREDENTIALS ---------- */
export const credentialsApi = {
  list: () => call<{ items: CredentialRecord[] }>("/api/credentials"),
  create: (input: CreateCredentialInput) =>
    call<CredentialRecord>("/api/credentials", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: UpdateCredentialInput) =>
    call<CredentialRecord>(`/api/credentials/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  delete: (id: string) =>
    call<void>(`/api/credentials/${id}`, { method: "DELETE" }),
};

/* ---------- Entry attachments (board) ---------- */
import type { EntryAttachment } from "@/lib/types";
import type {
  CreateAttachmentInput, UpdateAttachmentInput,
} from "@/lib/schemas/attachments";

export const attachmentsApi = {
  list: (entryId: string) =>
    call<{ items: EntryAttachment[] }>(`/api/entries/${entryId}/attachments`),
  create: (entryId: string, input: CreateAttachmentInput) =>
    call<EntryAttachment>(`/api/entries/${entryId}/attachments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateAttachmentInput) =>
    call<EntryAttachment>(`/api/attachments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  delete: (id: string) =>
    call<void>(`/api/attachments/${id}`, { method: "DELETE" }),
  reorder: (entryId: string, ids: string[]) =>
    call<void>(`/api/entries/${entryId}/attachments/reorder`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
};

/* ---------- URL metadata extraction ---------- */
export interface ExtractedMeta {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  videoId?: string;
  author?: string;
  duration?: string;
  tags?: string[];
  hasContent: boolean;
  /** Diagnostic breadcrumbs — visible in DevTools network panel. */
  _diag?: {
    scrape?: { ok: boolean; status?: number };
    oembed?: "skipped" | "ok" | "fail";
    innertube?: "skipped" | "ok" | "fail";
    mobile?: "skipped" | "ok" | "fail";
    invidious?: "skipped" | "ok" | "fail";
    consentWall?: boolean;
  };
}
export const extractApi = {
  fromUrl: (url: string) =>
    call<ExtractedMeta>("/api/extract", { method: "POST", body: JSON.stringify({ url }) }),
};

/* ---------- R2 storage ---------- */
export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  expiresAt: string;
}
export const r2Api = {
  presign: (input: {
    kind: "originals" | "covers" | "thumbs";
    fileName: string;
    contentType: string;
    contentLength: number;
  }) =>
    call<PresignedUpload>("/api/r2/presign", { method: "POST", body: JSON.stringify(input) }),
};

/* ---------- KANBAN ---------- */
export const kanbanApi = {
  list: () => call<Record<KanbanColumn, KanbanCard[]>>("/api/kanban"),
  create: (input: CreateKanbanInput) =>
    call<KanbanCard>("/api/kanban", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: UpdateKanbanInput) =>
    call<KanbanCard>(`/api/kanban/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  delete: (id: string) =>
    call<void>(`/api/kanban/${id}`, { method: "DELETE" }),
  reorder: (input: ReorderKanbanInput) =>
    call<void>("/api/kanban/reorder", { method: "POST", body: JSON.stringify(input) }),
};
