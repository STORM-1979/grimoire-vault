"use client";

import { useEffect, useState } from "react";

/**
 * `useState` that persists to `localStorage`.
 *
 * SSR-safe: the initial render returns the supplied `initial` so the
 * server-rendered HTML always matches; we hydrate from storage in a
 * mount effect.  The persist effect only runs after `hydrating` flips
 * to `false`, so the initial-value render doesn't overwrite the
 * just-loaded persisted value.
 *
 * Validation: callers may pass `validate` to reject malformed values
 * persisted by older builds (e.g. an enum widening).  If the stored
 * value fails validation, it's discarded and the slot stays at `initial`.
 *
 * Storage key convention: `gv:<scope>.<field>`  e.g. `gv:search.mode`.
 *
 * Errors (quota, disabled storage, JSON parse) are silently swallowed —
 * persistence is a UX nicety, not a correctness requirement, and we'd
 * rather degrade to in-memory state than throw.
 */
export function useLocalStorageState<T>(
  key: string,
  initial: T,
  options: { validate?: (v: unknown) => v is T } = {},
): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  // `hydrating === true` blocks the persist effect.  Hydrate effect
  // flips it to false AFTER setValue commits the persisted value.
  // Both setValue + setHydrating happen in the same effect run; React
  // batches them into a single re-render where `value` is the persisted
  // one and `hydrating` is false — so the persist effect on that render
  // writes the persisted value back to storage (no-op).
  const [hydrating, setHydrating] = useState(true);

  // Hydrate once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (!options.validate || options.validate(parsed)) {
          setValue(parsed as T);
        }
      }
    } catch { /* private mode / quota / corrupt — ignore */ }
    setHydrating(false);
    // Only depend on `key` — `options.validate` is not guaranteed to be
    // memoised by callers, and we don't want to re-hydrate every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on every value change after hydration.
  useEffect(() => {
    if (hydrating) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota / disabled — ignore */ }
  }, [key, value, hydrating]);

  return [value, setValue];
}
