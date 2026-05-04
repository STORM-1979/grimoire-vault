"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useVaults } from "@/lib/hooks/useVaults";

/**
 * Header dropdown that switches the active vault context.
 *
 * Hidden when the user has no shared vaults (only "Personal") — until
 * the user creates or accepts one in /settings, this is invisible noise.
 *
 * Selection lives in `gv:active-vault` localStorage; `useEntries` and
 * other data hooks consult the same slot so views auto-filter when
 * switched.
 */
export function VaultPicker() {
  const { vaults, activeId, setActiveId, activeName, loading } = useVaults();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // No shared vaults → don't take up header real estate.
  if (loading || vaults.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 hover:border-gold hover:text-gold transition text-ivory-mute font-mono text-[10px] uppercase tracking-widest"
        title="Сменить vault"
      >
        <Icon name="shield" size={11} />
        <span className="max-w-[160px] truncate">{activeName}</span>
        <span className="text-ivory-mute">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 max-h-[60vh] overflow-y-auto bg-emerald-deep border border-gold/30 rounded-xl shadow-2xl p-2">
            <button
              onClick={() => { setActiveId(null); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
                activeId === null ? "bg-gold/10 text-gold" : "hover:bg-white/[0.05] text-ivory"
              }`}
            >
              <Icon name="lock" size={14} className="text-emerald-200" />
              <div className="flex-1 min-w-0">
                <div className="font-display text-[14px] font-medium leading-tight">Personal</div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                  Только ты
                </div>
              </div>
              {activeId === null && <Icon name="check" size={11} />}
            </button>
            <div className="border-t border-white/10 my-1" />
            {vaults.map((v) => (
              <button
                key={v.id}
                onClick={() => { setActiveId(v.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
                  activeId === v.id ? "bg-gold/10 text-gold" : "hover:bg-white/[0.05] text-ivory"
                }`}
              >
                <Icon name="shield" size={14} className="text-emerald-200" />
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[14px] font-medium leading-tight truncate">{v.name}</div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                    {v.role === "owner" ? "Owner" : "Editor"}
                  </div>
                </div>
                {activeId === v.id && <Icon name="check" size={11} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
