"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocalStorageState } from "./useLocalStorageState";

export interface VaultListItem {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  role: "owner" | "editor";
}

/**
 * Active vault context across the client app.
 *
 * Source of truth: the `gv:active-vault` localStorage slot.  `null` = personal
 * mode (entries with vault_id IS NULL).  Any other value = a vault id from
 * `/api/vaults`.  Validated against the live list on mount; if the
 * persisted id no longer corresponds to a vault the user belongs to, we
 * fall back to personal silently.
 *
 * Hook surface:
 *   • vaults    — full membership list
 *   • activeId  — current selection (`null` for personal)
 *   • setActiveId — change selection (persists)
 *   • activeName — friendly label for the current selection
 *   • loading   — initial fetch in flight
 *   • refresh   — manual refetch (after create/leave actions)
 */
export function useVaults() {
  const [vaults, setVaults] = useState<VaultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useLocalStorageState<string | null>(
    "gv:active-vault",
    null,
    { validate: (v): v is string | null => v === null || (typeof v === "string" && v.length >= 36) },
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/vaults");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { items: VaultListItem[] };
      setVaults(body.items);
      // Drop active id if it no longer matches a known vault.
      if (activeId && !body.items.some((v) => v.id === activeId)) {
        setActiveId(null);
      }
    } catch { /* offline / not signed in: ignore */ }
    finally { setLoading(false); }
  }, [activeId, setActiveId]);

  // Single fetch on mount; subsequent updates flow through `refresh()`
  // which is callable from outside.  We deliberately don't depend on
  // `refresh` here — that would re-fire whenever activeId changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const activeName = activeId
    ? (vaults.find((v) => v.id === activeId)?.name ?? "…")
    : "Личный";

  return { vaults, activeId, setActiveId, activeName, loading, refresh };
}
