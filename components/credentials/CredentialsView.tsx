"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useMasterKey } from "@/lib/hooks/useMasterKey";
import { useCredentials } from "@/lib/hooks/useCredentials";
import { useLocalStorageState } from "@/lib/hooks/useLocalStorageState";
import { UnlockGate } from "./UnlockGate";
import { CredentialsTable } from "./CredentialsTable";
import { CredentialModal } from "./CredentialModal";
import { PrintableCredentials } from "./PrintableCredentials";
import {
  topLevelOwners, childrenOf, splitOwner, joinOwner, ownerMatches,
  ORPHAN_OWNER, OWNER_SEP,
} from "@/lib/credentials-owners";
import type { CredentialDecrypted } from "@/lib/types";

export function CredentialsView() {
  const mk = useMasterKey();
  const creds = useCredentials(mk.key);
  const [showAdd, setShowAdd] = useState(false);
  // null  → modal closed
  // record → edit mode, pre-fill with this decrypted row
  const [editing, setEditing] = useState<CredentialDecrypted | null>(null);
  // Owner filter — collection name as stored on the row.  Default
  // to ORPHAN_OWNER so the user lands on a real bucket on first
  // mount (the "Все" view is gone, every credential belongs to a
  // collection).  Switches when the user clicks a different chip.
  const [ownerFilter, setOwnerFilter] = useState<string>(ORPHAN_OWNER);
  // Empty collections — names the user created without filing a
  // credential into them yet.  Persisted to localStorage so they
  // survive reloads.  Pruned automatically when a credential lands
  // there (the name then shows up in distinctOwners and we drop
  // it from this list to avoid duplication).
  const [pendingCollections, setPendingCollections] = useLocalStorageState<string[]>(
    "gv:credentials:pending-collections",
    [],
    { validate: (v): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string") },
  );
  // Inline "+ Новая коллекция" input state — null = idle, "" =
  // input visible and empty.
  const [draftCollection, setDraftCollection] = useState<string | null>(null);
  // Same for the sub-collection input (appears in the sub-row
  // under an active parent).  Independent state so the top-row
  // and sub-row inputs don't fight each other.
  const [draftSub, setDraftSub] = useState<string | null>(null);

  if (!mk.ready) {
    return (
      <section className="text-center py-32 text-ivory-mute font-mono text-[11px] uppercase tracking-widest">
        Загружаю vault…
      </section>
    );
  }

  if (!mk.unlocked) {
    return (
      <UnlockGate
        isSetup={mk.isSetup}
        busy={mk.busy}
        error={mk.error}
        onSetup={mk.setup}
        onUnlock={mk.unlock}
      />
    );
  }

  // Top-level chips: distinct parent names from rows + pending
  // (empty) top-level collections.  ORPHAN_OWNER pinned to the end.
  const topList = (() => {
    const real = topLevelOwners(creds.items);
    const realSet = new Set(real);
    // pendingCollections may contain "Parent / Child" entries; only
    // their parent segment goes into the top row, child rows are
    // handled by the sub-row below.
    const pendingTops = pendingCollections
      .map((p) => splitOwner(p).parent)
      .filter((p) => !realSet.has(p));
    const merged = [...real, ...pendingTops].filter((n) => n !== ORPHAN_OWNER);
    const dedup = Array.from(new Set(merged));
    dedup.sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));
    return [...dedup, ORPHAN_OWNER];
  })();

  // Currently-active parent (derived from ownerFilter).
  const activeParent = splitOwner(ownerFilter).parent;

  // Sub-row children for the active parent.  Includes both real
  // ones (from row data) and pending ones (saved-empty
  // sub-collections in localStorage).
  const subList = (() => {
    const real = childrenOf(creds.items, activeParent);
    const realSet = new Set(real);
    const pendingSubs = pendingCollections
      .map((p) => splitOwner(p))
      .filter((s) => s.child && s.parent === activeParent && !realSet.has(s.child!))
      .map((s) => s.child!);
    const merged = [...real, ...pendingSubs];
    return Array.from(new Set(merged)).sort((a, b) =>
      a.localeCompare(b, "ru", { sensitivity: "base" }),
    );
  })();

  // Apply the hierarchical filter — parent-only matches parent +
  // every descendant; child path matches exactly.
  const ownerFiltered = creds.items.filter((c) => ownerMatches(c.owner, ownerFilter));
  const pinned = ownerFiltered.filter((c) => c.pinned);
  const others = ownerFiltered.filter((c) => !c.pinned);

  // Counts per chip — top-level chips count themselves + descendants,
  // child chips count exact matches.
  const topCounts = Object.fromEntries(
    topList.map((name) => [
      name,
      creds.items.filter((c) => ownerMatches(c.owner, name)).length,
    ]),
  ) as Record<string, number>;
  const subCounts = Object.fromEntries(
    subList.map((child) => {
      const full = joinOwner(activeParent, child);
      return [child, creds.items.filter((c) => (c.owner?.trim() || ORPHAN_OWNER) === full).length];
    }),
  ) as Record<string, number>;
  // Used by the modal — needs the FULL list of chips it can offer.
  const ownerList = (() => {
    const set = new Set<string>(topList);
    for (const top of topList) {
      for (const child of childrenOf(creds.items, top)) set.add(joinOwner(top, child));
    }
    for (const p of pendingCollections) set.add(p);
    return Array.from(set);
  })();

  return (
    <div>
      {/* Stats + actions */}
      <div className="max-w-[1480px] mx-auto px-10 -mt-24 mb-8 flex items-end justify-end gap-3">
        <div className="keynote text-center min-w-[110px] p-4">
          <div className="font-display text-[32px] font-light text-gold leading-none">{creds.items.length}</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Записей</div>
        </div>
        <div className="keynote text-center min-w-[110px] p-4">
          <div className="font-display text-[32px] font-light text-gold leading-none">{pinned.length}</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Закреплено</div>
        </div>
        <button
          onClick={() => {
            // Hard confirmation — paper copies of passwords are
            // irreversible disclosures.  The user has to explicitly
            // acknowledge before the print dialog comes up.
            if (creds.items.length === 0) return;
            const ok = confirm(
              `Распечатать все пароли (${creds.items.length} шт.)?\n\nОни появятся в виде открытого текста.  Не оставляй распечатку без присмотра — после использования храни в сейфе или уничтожь.`,
            );
            if (!ok) return;
            // Defer to next tick so the confirm dialog fully closes
            // before the browser print preview pops up.
            setTimeout(() => window.print(), 50);
          }}
          disabled={creds.items.length === 0}
          title="Распечатать все пароли в открытом виде"
          className="border border-white/30 text-ivory-dim px-4 py-3 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-gold hover:text-gold disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
        >
          <Icon name="documents" size={13} /> Распечатать
        </button>
        <button
          onClick={mk.lock}
          title="Заблокировать vault"
          className="border border-white/30 text-ivory-dim px-4 py-3 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-gold hover:text-gold transition flex items-center gap-2"
        >
          <Icon name="lock" size={13} /> Запереть
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-ivory text-emerald-950 px-5 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition flex items-center gap-2"
        >
          <Icon name="add" size={16} /> Добавить пароль
        </button>
      </div>

      {/* Print-only sheet — invisible on screen via `hidden`
          Tailwind class + the @media print rules in globals.css
          make it the sole visible element when window.print() fires. */}
      <PrintableCredentials items={creds.items} />

      {showAdd && (
        <CredentialModal
          ownerOptions={ownerList}
          onClose={() => setShowAdd(false)}
          onSubmit={async (input) => {
            await creds.create(input);
            // Snap the filter to whichever bucket the new credential
            // landed in, and drop that name from pendingCollections
            // — it's now a real bucket (distinctOwners picks it up
            // from the row set on next render).
            if (input.owner) {
              setOwnerFilter(input.owner);
              setPendingCollections((p) => p.filter((n) => n !== input.owner));
            }
          }}
        />
      )}

      {editing && (
        <CredentialModal
          initial={editing}
          ownerOptions={ownerList}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await creds.update(editing.id, input);
            if (input.owner) {
              setOwnerFilter(input.owner);
              setPendingCollections((p) => p.filter((n) => n !== input.owner));
            }
          }}
        />
      )}

      {/* Security warning */}
      <section className="max-w-[1480px] mx-auto px-10 pt-2">
        <div className="flex items-start gap-4 p-5 rounded-xl border border-gold/30 bg-gold/[0.04]">
          <div className="text-gold flex-shrink-0 mt-0.5"><Icon name="shield" size={22} /></div>
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">Шифрование</div>
            <p className="text-[13.5px] text-ivory-dim leading-snug font-light">
              Пароли зашифрованы на клиенте через <span className="text-ivory">PBKDF2-SHA256 (600k итераций)</span> →{" "}
              <span className="text-ivory">AES-GCM-256</span> с уникальным IV на каждое поле. Сервер видит только base64-blobs.
              Мастер-пароль живёт в <span className="text-ivory">sessionStorage</span> до закрытия вкладки.
            </p>
          </div>
        </div>
      </section>

      {creds.error && (
        <div className="max-w-[1480px] mx-auto px-10 mt-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {creds.error}
        </div>
      )}

      {/* Collection filter strip — two-level.  Top row shows all
          parent collections + "+ Новая коллекция".  When a parent
          is active, a sub-row appears underneath with its children
          + "+ Новая подколлекция".  Same pattern as the entries
          CollectionsTabs. */}
      <section className="max-w-[1480px] mx-auto px-10 mt-4">
        {/* Top row */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute pr-1">
            коллекция →
          </span>
          {topList.map((name) => (
            <OwnerChip
              key={name}
              label={name}
              count={topCounts[name] ?? 0}
              active={activeParent === name}
              italic={name === ORPHAN_OWNER}
              onClick={() => setOwnerFilter(name)}
            />
          ))}
          {draftCollection === null ? (
            <button
              type="button"
              onClick={() => setDraftCollection("")}
              className="font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
              title="Создать новую коллекцию"
            >
              <Icon name="add" size={11} /> Новая коллекция
            </button>
          ) : (
            <input
              autoFocus
              type="text"
              value={draftCollection}
              placeholder="название"
              onChange={(e) => setDraftCollection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const name = draftCollection.trim();
                  if (!name) { setDraftCollection(null); return; }
                  if (!topList.includes(name)) {
                    setPendingCollections((p) => p.includes(name) ? p : [...p, name]);
                  }
                  setOwnerFilter(name);
                  setDraftCollection(null);
                } else if (e.key === "Escape") setDraftCollection(null);
              }}
              onBlur={() => {
                const name = draftCollection.trim();
                if (name && !topList.includes(name)) {
                  setPendingCollections((p) => p.includes(name) ? p : [...p, name]);
                  setOwnerFilter(name);
                }
                setDraftCollection(null);
              }}
              className="font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full bg-emerald-deep border border-emerald-300 text-ivory min-w-[160px] focus:outline-none"
            />
          )}
        </div>

        {/* Sub-row — only visible when a non-orphan parent is
            selected.  Always shows the "+ Новая подколлекция"
            button so the user can spin one up even before any
            child exists.  ORPHAN_OWNER is intentionally leaf-only —
            sub-collections under it would be confusing semantics. */}
        {activeParent !== ORPHAN_OWNER && (
          <div className="mt-2.5 pl-4 border-l-2 border-gold/20 flex flex-wrap gap-2 items-center">
            <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute pr-1">
              подколлекции →
            </span>
            {/* Sentinel "сам" chip = filter to parent-only (records
                directly under the parent, not in any sub).  Shown
                only when sub-collections exist OR the user is on a
                sub-collection — keeps the chip from cluttering the
                strip when there's nothing to disambiguate. */}
            {(subList.length > 0 || ownerFilter !== activeParent) && (
              <OwnerChip
                label="без подколлекции"
                count={creds.items.filter((c) => (c.owner?.trim() || ORPHAN_OWNER) === activeParent).length}
                active={ownerFilter === activeParent}
                italic
                onClick={() => setOwnerFilter(activeParent)}
              />
            )}
            {subList.map((child) => {
              const full = joinOwner(activeParent, child);
              return (
                <OwnerChip
                  key={child}
                  label={child}
                  count={subCounts[child] ?? 0}
                  active={ownerFilter === full}
                  onClick={() => setOwnerFilter(full)}
                />
              );
            })}
            {draftSub === null ? (
              <button
                type="button"
                onClick={() => setDraftSub("")}
                className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/25 text-emerald-200/80 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
                title={`Создать новую подколлекцию внутри «${activeParent}»`}
              >
                <Icon name="add" size={10} /> Новая подколлекция
              </button>
            ) : (
              <input
                autoFocus
                type="text"
                value={draftSub}
                placeholder="название"
                onChange={(e) => setDraftSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const name = draftSub.trim();
                    if (!name) { setDraftSub(null); return; }
                    const full = joinOwner(activeParent, name);
                    if (!ownerList.includes(full)) {
                      setPendingCollections((p) => p.includes(full) ? p : [...p, full]);
                    }
                    setOwnerFilter(full);
                    setDraftSub(null);
                  } else if (e.key === "Escape") setDraftSub(null);
                }}
                onBlur={() => {
                  const name = draftSub.trim();
                  if (name) {
                    const full = joinOwner(activeParent, name);
                    if (!ownerList.includes(full)) {
                      setPendingCollections((p) => p.includes(full) ? p : [...p, full]);
                    }
                    setOwnerFilter(full);
                  }
                  setDraftSub(null);
                }}
                className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full bg-emerald-deep border border-emerald-300 text-ivory min-w-[140px] focus:outline-none"
              />
            )}
          </div>
        )}
      </section>

      {pinned.length > 0 && (
        <section className="max-w-[1480px] mx-auto px-10 py-8">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4 flex items-center gap-2">
            <Icon name="pin" size={14} /> Закреплено
          </div>
          <CredentialsTable
            items={pinned}
            onTogglePin={creds.togglePin}
            onDelete={creds.remove}
            onEdit={setEditing}
          />
        </section>
      )}

      <section className="max-w-[1480px] mx-auto px-10 py-8">
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4">Все записи · {others.length}</div>
        <CredentialsTable
          items={others}
          onTogglePin={creds.togglePin}
          onDelete={creds.remove}
          onEdit={setEditing}
        />
      </section>

      {creds.items.length === 0 && !creds.loading && (
        <section className="max-w-[1480px] mx-auto px-10 py-32 text-center">
          <div className="text-ivory-mute font-light italic mb-4">— vault пуст —</div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
            Жми «Добавить пароль» чтобы сохранить первый аккаунт
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Owner filter chip — gold-filled when active, hairline border
 * otherwise.  Count badge in the chip's trailing slot so the user
 * can see "Вова · 3" without opening the bucket first.  Italic
 * style optional — used for the "Без владельца" sentinel to
 * separate it visually from the named-owner chips.
 */
function OwnerChip({
  label, count, active, onClick, italic = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full transition flex items-center gap-1.5 " +
        (italic ? "italic " : "") +
        (active
          ? "bg-gold text-emerald-deep"
          : "border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40")
      }
    >
      <span>{label}</span>
      <span className={active ? "text-emerald-deep/60" : "text-ivory-mute/60"}>
        {count}
      </span>
    </button>
  );
}
