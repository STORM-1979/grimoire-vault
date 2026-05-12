/**
 * Shared domain types — the lingua franca between database, API and UI.
 */

export type CategoryId =
  | "documents"
  | "web"
  | "youtube"
  | "local"
  | "designs"
  | "images"
  | "skills"
  | "prompts"
  | "kanban"
  | "ideas"
  | "portfolio"
  | "misc"
  | "credentials"
  | "tools"
  | "bots";

export type IconName =
  | "documents" | "web" | "youtube" | "local" | "designs" | "images"
  | "skills" | "prompts" | "kanban" | "ideas" | "portfolio" | "misc"
  | "tools" | "bots"
  | "lock" | "search" | "inbox" | "settings" | "add" | "arrow"
  | "pin" | "pinFilled" | "star" | "play" | "x" | "check"
  | "eye" | "eyeOff" | "copy" | "shield" | "refresh"
  | "edit" | "drag" | "wifi" | "wifiOff" | "sort" | "trash";

export interface Category {
  id: CategoryId;
  no: string;            // '01' .. '13'
  en: string;
  ru: string;
  icon: IconName;
  ordering: number;
  secured?: boolean;
}

export type ImportedVia = "web" | "bot" | "cli" | "api";

export type AttachmentKind = "image" | "video" | "link" | "note" | "file";

/**
 * A single block on an entry's "interactive board" — one of:
 *   • image  (R2 or external URL → <img>)
 *   • video  (YouTube / Vimeo URL → iframe; raw .mp4 → <video>)
 *   • link   (URL with title / description / thumbnail from og: extract)
 *   • note   (plain text, no URL)
 *   • file   (R2 download — PDF / ZIP / arbitrary)
 */
export interface EntryAttachment {
  id: string;
  entryId: string;
  userId: string;
  kind: AttachmentKind;
  url?: string | null;
  caption?: string | null;
  body?: string | null;
  thumbUrl?: string | null;
  metadata: Record<string, unknown>;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Universal entry — everything except credentials and kanban.
 * Mirrors the `entries` table 1:1 (snake_case in db, camel here via mapper).
 */
export interface Entry {
  id: string;                       // uuid
  userId: string;
  categoryId: CategoryId;
  title: string;
  description?: string | null;
  body?: string | null;             // for prompt persona body, long notes
  url?: string | null;
  thumbUrl?: string | null;
  coverUrl?: string | null;
  duration?: string | null;
  sizeBytes?: number | null;
  sizeLabel?: string | null;
  fileCount?: number | null;
  sourcePath?: string | null;
  extractedText?: string | null;
  aiSummary?: string | null;
  contentHash?: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  pinned: boolean;
  importedVia: ImportedVia;
  /**
   * When this entry was filed away from the inbox.  Null for fresh
   * bot-imported rows that still need review; ISO timestamp once the
   * user has confirmed (or moved) the category.
   */
  triagedAt?: string | null;
  /**
   * Shared-vault scope.  Null = personal (visible only to the
   * `userId` author).  Non-null = visible to every member of that
   * vault (read + write per RLS).
   */
  vaultId?: string | null;
  /**
   * User-defined collection inside the system category (e.g. a
   * "Курсы" sub-folder under YouTube).  Null = unassigned, lives at
   * the root of the category.
   */
  collectionId?: string | null;
  /**
   * Soft-delete tombstone.  Null = live; ISO timestamp = in the
   * trash, surfaces only on /trash, restorable via the restore
   * endpoint, permanently deletable via /purge.  All live-list
   * queries filter `deleted_at IS NULL` automatically.
   */
  deletedAt?: string | null;
  createdAt: string;                // ISO timestamp
  updatedAt: string;
}

/**
 * User-defined sub-folder inside a system category.  Created and
 * managed via the collections API.  parent_id supports two-level
 * nesting in the schema; the initial UI uses a flat list.
 */
export interface EntryCollection {
  id: string;
  userId: string;
  categoryId: CategoryId;
  parentId?: string | null;
  name: string;
  slug: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRecord {
  id: string;
  userId: string;
  service: string;
  url?: string | null;
  /** AES-GCM ciphertexts, base64 — decrypt only on client.  Password
   *  and its IV are nullable for SSO / passkey-only / email-link
   *  accounts that have no standalone password to store. */
  usernameEncrypted: string;
  passwordEncrypted?: string | null;
  notesEncrypted?: string | null;
  /** Per-field IVs (base64) — never reused across fields, AES-GCM safety. */
  ivUsername: string;
  ivPassword?: string | null;
  ivNotes?: string | null;
  twoFactor: boolean;
  strength: "weak" | "medium" | "strong" | null;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Decrypted view used in the UI after the master key unlocks the vault. */
export interface CredentialDecrypted {
  id: string;
  service: string;
  url?: string | null;
  username: string;
  password: string;
  notes?: string | null;
  twoFactor: boolean;
  strength: "weak" | "medium" | "strong" | null;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Kanban column slug.  The three defaults — backlog / doing / done —
 * are guaranteed to exist on every board.  Users can add custom
 * columns; their slugs follow the same `[a-z0-9_-]{1,40}` shape but
 * are otherwise arbitrary.
 */
export type KanbanColumn = string;

/** Display metadata for a column on the board.  `custom` flips on
 *  for user-added columns so the UI can offer rename / delete on
 *  hover (defaults stay fixed). */
export interface KanbanColumnDef {
  slug: KanbanColumn;
  name: string;
  custom: boolean;
}

export type Priority = "low" | "medium" | "high";

export interface KanbanCard {
  id: string;
  userId: string;
  columnName: KanbanColumn;
  position: number;
  title: string;
  description?: string | null;
  relatedCategory?: CategoryId | null;
  dueDate?: string | null;          // YYYY-MM-DD
  priority: Priority;
  progress?: number | null;         // 0-100
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

