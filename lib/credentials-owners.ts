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

/**
 * Path separator for hierarchical collections.  We store full paths
 * in the `owner` column ("Вова" or "Вова / Личное"), no schema
 * change.  Spaces around the slash make it both readable and
 * unlikely to collide with normal text — a user typing "TCP/IP" as
 * a collection name won't accidentally produce a sub-collection.
 */
export const OWNER_SEP = " / ";

export function getOwnerLabel(name: string | null | undefined): string {
  return name?.trim() || ORPHAN_OWNER;
}

/** Split a path into parent + (optional) child segments. */
export function splitOwner(owner: string): { parent: string; child: string | null } {
  const idx = owner.indexOf(OWNER_SEP);
  if (idx === -1) return { parent: owner, child: null };
  return { parent: owner.slice(0, idx), child: owner.slice(idx + OWNER_SEP.length) };
}

export function joinOwner(parent: string, child?: string | null): string {
  return child ? `${parent}${OWNER_SEP}${child}` : parent;
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

/**
 * Top-level parent names — first segment of every owner path.
 * Used for the primary chip row on the filter strip and the modal
 * picker.  ORPHAN_OWNER is always included.
 */
export function topLevelOwners(rows: Array<{ owner?: string | null }>): string[] {
  const set = new Set<string>([ORPHAN_OWNER]);
  for (const r of rows) {
    const v = r.owner?.trim();
    if (!v) continue;
    set.add(splitOwner(v).parent);
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, "ru", { sensitivity: "base" }),
  );
}

/** Distinct sub-collection names that live under `parent`. */
export function childrenOf(
  rows: Array<{ owner?: string | null }>,
  parent: string,
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r.owner?.trim();
    if (!v) continue;
    const { parent: p, child } = splitOwner(v);
    if (p === parent && child) set.add(child);
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, "ru", { sensitivity: "base" }),
  );
}

/**
 * Does an owner path match the filter?  Parent-only filter
 * (no separator) matches its exact name OR any descendant.
 * A child path matches exactly.
 */
export function ownerMatches(owner: string | null | undefined, filter: string): boolean {
  const value = (owner?.trim() || ORPHAN_OWNER);
  if (filter.includes(OWNER_SEP)) return value === filter;
  return value === filter || value.startsWith(filter + OWNER_SEP);
}
