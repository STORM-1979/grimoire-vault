"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

interface VaultMember { vaultId: string; userId: string; email: string | null; role: "owner" | "editor"; joinedAt: string }
interface Vault { id: string; name: string; ownerId: string; createdAt: string; role: "owner" | "editor" }
interface Invite { id: string; vaultId: string; code: string; expiresAt: string; usedAt: string | null }

/**
 * Settings → "Shared vaults" panel.
 *
 * Concerns:
 *   • Listing vaults the caller belongs to (with their role).
 *   • Creating a new vault.
 *   • For each owned vault: members list, invite link generator,
 *     pending-invite list with revoke, danger-zone delete.
 *   • For non-owned vaults: leave button.
 *
 * Owner-only ops use service-role on the server; the UI just sends the
 * intent and reads the response.
 */
export function VaultsPanel({ ownerUserId }: { ownerUserId: string }) {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/vaults");
      const body = await r.json();
      setVaults(body.items ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/vaults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setName("");
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "create failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="keynote rounded-2xl p-6 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
            Shared workspaces
          </div>
          <h3 className="font-display text-[22px] font-medium leading-tight">
            Vaults
          </h3>
        </div>
        <Icon name="shield" size={18} className="text-emerald-200" />
      </div>
      <p className="text-[13.5px] text-ivory-dim leading-snug font-light mb-4">
        Создай vault и пригласи близких — каждый член может добавлять и редактировать
        записи внутри. Personal-mode остаётся приватным. Credentials и kanban пока
        живут только в personal — credentials завязаны на твой master-пароль.
      </p>

      {/* Create */}
      <div className="flex items-center gap-2 mb-5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="Family vault"
          className="field-input flex-1"
        />
        <button
          onClick={create}
          disabled={busy || !name.trim()}
          className="bg-ivory text-emerald-950 px-4 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:bg-emerald-100 disabled:opacity-50 transition flex items-center gap-2"
        >
          <Icon name="add" size={13} /> Создать
        </button>
      </div>

      {error && (
        <div className="font-mono text-[11px] text-red-400 mb-3 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {vaults.length === 0 ? (
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute py-3 text-center border border-dashed border-white/10 rounded-lg">
          Пока нет shared vault&apos;ов
        </div>
      ) : (
        <div className="space-y-3">
          {vaults.map((v) => (
            <VaultCard key={v.id} vault={v} ownerUserId={ownerUserId} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function VaultCard({ vault, ownerUserId, onChange }: { vault: Vault; ownerUserId: string; onChange: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<VaultMember[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastInvite, setLastInvite] = useState<Invite | null>(null);
  const isOwner = vault.role === "owner";

  const loadDetails = useCallback(async () => {
    try {
      const m = await (await fetch(`/api/vaults/${vault.id}/members`)).json();
      setMembers(m.items ?? []);
      if (isOwner) {
        const i = await (await fetch(`/api/vaults/${vault.id}/invites`)).json();
        setInvites(i.items ?? []);
      }
    } catch { /* ignore */ }
  }, [vault.id, isOwner]);

  useEffect(() => { if (expanded) loadDetails(); }, [expanded, loadDetails]);

  const createInvite = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/vaults/${vault.id}/invites`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      const inv = await r.json();
      setLastInvite(inv);
      loadDetails();
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  const revoke = async (inviteId: string) => {
    await fetch(`/api/vaults/${vault.id}/invites?invite=${encodeURIComponent(inviteId)}`, { method: "DELETE" });
    loadDetails();
  };

  const kick = async (memberId: string) => {
    if (!confirm("Удалить участника из vault'а?")) return;
    await fetch(`/api/vaults/${vault.id}/members?user=${encodeURIComponent(memberId)}`, { method: "DELETE" });
    loadDetails();
    onChange();
  };

  const leave = async () => {
    if (!confirm("Покинуть vault?")) return;
    await fetch(`/api/vaults/${vault.id}/members`, { method: "DELETE" });
    onChange();
  };

  const deleteVault = async () => {
    if (!confirm(`Удалить vault «${vault.name}»? Все его записи перейдут в "осиротевшие" (vault_id обнулится).`)) return;
    await fetch(`/api/vaults/${vault.id}`, { method: "DELETE" });
    onChange();
  };

  const inviteUrl = lastInvite ? `${window.location.origin}/invite/${lastInvite.code}` : null;

  return (
    <div className="keynote rounded-xl border border-white/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.03] transition rounded-xl"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Icon name="shield" size={16} className="text-emerald-200 flex-shrink-0" />
          <div className="min-w-0 flex-1 text-left">
            <div className="font-display text-[16px] font-medium leading-tight truncate">{vault.name}</div>
            <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
              {vault.role} · created {new Date(vault.createdAt).toLocaleDateString("ru-RU")}
            </div>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
          {expanded ? "—" : "+"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/10 pt-3">
          {/* Members */}
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">Members</div>
          {members === null ? (
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">Загружаю…</div>
          ) : (
            <div className="space-y-1 mb-4">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/[0.03]">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12px] truncate">{m.email ?? m.userId}</div>
                    <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                      {m.role}
                    </div>
                  </div>
                  {isOwner && m.userId !== ownerUserId && (
                    <button
                      onClick={() => kick(m.userId)}
                      className="font-mono text-[10px] uppercase tracking-widest text-red-300 hover:text-red-100 transition px-2 py-1"
                    >
                      Удалить
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Invites (owner only) */}
          {isOwner && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-[10px] uppercase tracking-widest text-gold">Invites</div>
                <button
                  onClick={createInvite}
                  disabled={busy}
                  className="font-mono text-[10px] uppercase tracking-widest px-3 py-1 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Icon name="add" size={11} /> {busy ? "…" : "Новая ссылка"}
                </button>
              </div>

              {lastInvite && inviteUrl && (
                <div className="mb-3 p-3 rounded-lg border border-emerald-300/30 bg-emerald-200/[0.04]">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-200 mb-1">
                    Свежая ссылка · действует 7 дней
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="field-input font-mono text-[11px] flex-1"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(inviteUrl)}
                      className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition"
                      title="Скопировать"
                    >
                      <Icon name="copy" size={11} />
                    </button>
                  </div>
                </div>
              )}

              {invites && invites.length > 0 && (
                <div className="space-y-1 mb-4">
                  {invites.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/[0.03]">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11px] truncate">…{i.code.slice(-8)}</div>
                        <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                          {i.usedAt
                            ? `использован ${new Date(i.usedAt).toLocaleDateString("ru-RU")}`
                            : `действует до ${new Date(i.expiresAt).toLocaleDateString("ru-RU")}`}
                        </div>
                      </div>
                      {!i.usedAt && (
                        <button
                          onClick={() => revoke(i.id)}
                          className="font-mono text-[10px] uppercase tracking-widest text-red-300 hover:text-red-100 transition px-2 py-1"
                        >
                          Отозвать
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Owner / leave actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/8">
            {isOwner ? (
              <button
                onClick={deleteVault}
                className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-red-400/40 text-red-300 hover:bg-red-400 hover:text-emerald-deep transition flex items-center gap-1.5"
              >
                <Icon name="x" size={11} /> Удалить vault
              </button>
            ) : (
              <button
                onClick={leave}
                className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-red-400 hover:text-red-300 transition flex items-center gap-1.5"
              >
                Покинуть vault
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
