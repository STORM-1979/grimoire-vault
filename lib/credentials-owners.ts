/**
 * Account-owner ("collection") helpers for the credentials vault.
 *
 * No hardcoded list anymore — the user creates collections freely
 * from the credentials view by typing a new name.  This module
 * just hosts:
 *   - the sentinel name for the auto-created bucket migrations
 *     route orphan rows into ("Без коллекции")
 *   - utilities to derive the distinct collection list from the
 *     current credential rows, plus a getOwnerLabel helper for the
 *     few spots that just need a display string
 *
 * Owner column stores the raw label string (Russian or whatever
 * the user typed) — this is plaintext metadata, no encryption, no
 * id↔label indirection.  Simpler than the previous registry and
 * matches how entry_collections work on the entries side.
 */
export const ORPHAN_OWNER = "Без коллекции";

export function getOwnerLabel(name: string | null | undefined): string {
  return name?.trim() || ORPHAN_OWNER;
}

/**
 * Distinct owner names from a credentials list, alphabetised
 * Russian-first.  Always includes the orphan bucket label so the
 * UI can render its chip even if no row currently uses it.
 */
export function distinctOwners(rows: Array<{ owner?: string | null }>): string[] {
  const set = new Set<string>([ORPHAN_OWNER]);
  for (const r of rows) {
    const v = r.owner?.trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, "ru", { sensitivity: "base" }),
  );
}
