import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { DataError } from "@/lib/errors";

/**
 * Server-side data access for shared vaults.
 *
 * "Personal mode" = entries with `vault_id IS NULL`.  Every user has
 * one implicit personal mode by default; shared vaults are extra.
 *
 * Roles:
 *   • owner  — created the vault; can invite, kick, delete
 *   • editor — full CRUD on entries inside this vault, can leave it
 *
 * RLS does the actual gating; this module is the typed surface for
 * route handlers to check membership / fetch lists / write rows.
 */

export interface Vault {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface VaultMember {
  vaultId: string;
  userId: string;
  email?: string | null;
  role: "owner" | "editor";
  joinedAt: string;
}

export interface VaultInvite {
  id: string;
  vaultId: string;
  code: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

/* ---------- Membership ---------- */

/**
 * List every vault the calling user is a member of, plus their role.
 * Used to populate the VaultPicker in the header.
 */
export async function listMyVaults(): Promise<Array<Vault & { role: "owner" | "editor" }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vault_members")
    .select("role, vaults(id, name, owner_id, created_at)")
    .order("joined_at", { ascending: true });
  if (error) throw new DataError(error.message, 500);
  return (data ?? [])
    .map((row) => {
      const v = row.vaults as unknown as { id: string; name: string; owner_id: string; created_at: string } | null;
      if (!v) return null;
      return {
        id: v.id,
        name: v.name,
        ownerId: v.owner_id,
        createdAt: v.created_at,
        role: row.role as "owner" | "editor",
      };
    })
    .filter((v): v is Vault & { role: "owner" | "editor" } => v !== null);
}

export async function getVault(vaultId: string): Promise<Vault | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vaults").select("id, name, owner_id, created_at")
    .eq("id", vaultId).maybeSingle();
  if (error) throw new DataError(error.message, 500);
  if (!data) return null;
  return { id: data.id, name: data.name, ownerId: data.owner_id, createdAt: data.created_at };
}

export async function isMember(vaultId: string, userId: string): Promise<{ role: "owner" | "editor" } | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("vault_members").select("role")
    .eq("vault_id", vaultId).eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return { role: data.role as "owner" | "editor" };
}

export async function listMembers(vaultId: string): Promise<VaultMember[]> {
  // Read members via RLS-scoped client first (membership check is automatic).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vault_members")
    .select("vault_id, user_id, role, joined_at")
    .eq("vault_id", vaultId)
    .order("joined_at", { ascending: true });
  if (error) throw new DataError(error.message, 500);
  // Enrich with email lookup via service-role admin API (RLS-bypassing).
  const svc = createServiceClient();
  const out: VaultMember[] = [];
  for (const r of data ?? []) {
    let email: string | null = null;
    try {
      const { data: u } = await svc.auth.admin.getUserById(r.user_id as string);
      email = u?.user?.email ?? null;
    } catch { /* ignore */ }
    out.push({
      vaultId: r.vault_id as string,
      userId: r.user_id as string,
      role: r.role as "owner" | "editor",
      joinedAt: r.joined_at as string,
      email,
    });
  }
  return out;
}

/* ---------- Mutations ---------- */

export async function createVault(userId: string, name: string): Promise<Vault> {
  // Use service-role: vaults_insert_self WITH CHECK (auth.uid() = owner_id)
  // sometimes mis-resolves auth.uid() in mixed-runtime cases (Edge vs Node)
  // because the JWT propagation is finicky.  The route handler has already
  // verified `userId` from the cookie session via requireUser(), so we
  // hard-scope owner_id here ourselves.
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("vaults")
    .insert({ name: name.trim(), owner_id: userId })
    .select("id, name, owner_id, created_at")
    .single();
  if (error) throw new DataError(error.message, 500);
  // Trigger seeds the owner as member; nothing else to do.
  return { id: data.id, name: data.name, ownerId: data.owner_id, createdAt: data.created_at };
}

export async function deleteVault(userId: string, vaultId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("vaults").delete().eq("id", vaultId).eq("owner_id", userId);
  if (error) throw new DataError(error.message, 500);
}

export async function leaveVault(userId: string, vaultId: string): Promise<void> {
  const supabase = await createClient();
  // Owner can't leave their own vault — must transfer or delete.
  const { data: vault } = await supabase.from("vaults").select("owner_id").eq("id", vaultId).maybeSingle();
  if (vault?.owner_id === userId) {
    throw new DataError("Owner can't leave their own vault — delete it instead", 400);
  }
  const svc = createServiceClient();
  const { error } = await svc.from("vault_members").delete().eq("vault_id", vaultId).eq("user_id", userId);
  if (error) throw new DataError(error.message, 500);
}

export async function removeMember(ownerId: string, vaultId: string, memberUserId: string): Promise<void> {
  const svc = createServiceClient();
  // Confirm caller is the owner before operating with service-role.
  const { data: vault } = await svc.from("vaults").select("owner_id").eq("id", vaultId).maybeSingle();
  if (!vault || vault.owner_id !== ownerId) {
    throw new DataError("Only the vault owner can remove members", 403);
  }
  if (memberUserId === ownerId) {
    throw new DataError("Owner can't remove themselves", 400);
  }
  const { error } = await svc.from("vault_members").delete()
    .eq("vault_id", vaultId).eq("user_id", memberUserId);
  if (error) throw new DataError(error.message, 500);
}

/* ---------- Invites ---------- */

/** Cryptographically-random URL-safe code. */
function generateInviteCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createInvite(ownerId: string, vaultId: string): Promise<VaultInvite> {
  const svc = createServiceClient();
  const { data: vault } = await svc.from("vaults").select("owner_id").eq("id", vaultId).maybeSingle();
  if (!vault || vault.owner_id !== ownerId) {
    throw new DataError("Only the vault owner can create invites", 403);
  }
  const code = generateInviteCode();
  const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const { data, error } = await svc.from("vault_invites").insert({
    vault_id: vaultId, code, created_by: ownerId, expires_at: expires,
  }).select("*").single();
  if (error) throw new DataError(error.message, 500);
  return {
    id: data.id, vaultId: data.vault_id, code: data.code, createdBy: data.created_by,
    expiresAt: data.expires_at, usedAt: data.used_at, usedBy: data.used_by, createdAt: data.created_at,
  };
}

export async function listInvites(ownerId: string, vaultId: string): Promise<VaultInvite[]> {
  const svc = createServiceClient();
  const { data: vault } = await svc.from("vaults").select("owner_id").eq("id", vaultId).maybeSingle();
  if (!vault || vault.owner_id !== ownerId) {
    throw new DataError("Only the vault owner can list invites", 403);
  }
  const { data, error } = await svc.from("vault_invites")
    .select("*").eq("vault_id", vaultId).order("created_at", { ascending: false });
  if (error) throw new DataError(error.message, 500);
  return (data ?? []).map((d) => ({
    id: d.id, vaultId: d.vault_id, code: d.code, createdBy: d.created_by,
    expiresAt: d.expires_at, usedAt: d.used_at, usedBy: d.used_by, createdAt: d.created_at,
  }));
}

export async function revokeInvite(ownerId: string, inviteId: string): Promise<void> {
  const svc = createServiceClient();
  // Verify ownership of the invite's vault.
  const { data: inv } = await svc.from("vault_invites").select("vault_id").eq("id", inviteId).maybeSingle();
  if (!inv) throw new DataError("Invite not found", 404);
  const { data: vault } = await svc.from("vaults").select("owner_id").eq("id", inv.vault_id).maybeSingle();
  if (!vault || vault.owner_id !== ownerId) throw new DataError("Forbidden", 403);
  const { error } = await svc.from("vault_invites").delete().eq("id", inviteId);
  if (error) throw new DataError(error.message, 500);
}

/**
 * Consume an invite code: mark it used and add the caller as a member
 * (default role: editor).  Idempotent — if the user is already a member,
 * this still marks the invite used and returns the vault.
 */
export async function acceptInvite(userId: string, code: string): Promise<{ vault: Vault; alreadyMember: boolean }> {
  const svc = createServiceClient();
  const { data: inv } = await svc
    .from("vault_invites")
    .select("id, vault_id, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();
  if (!inv) throw new DataError("Invite not found", 404);
  if (inv.used_at) throw new DataError("Invite already used", 410);
  if (new Date(inv.expires_at) < new Date()) throw new DataError("Invite expired", 410);

  // Add membership (no-op if already there).
  const { data: existing } = await svc
    .from("vault_members")
    .select("user_id").eq("vault_id", inv.vault_id).eq("user_id", userId).maybeSingle();
  const alreadyMember = !!existing;

  if (!alreadyMember) {
    const { error } = await svc.from("vault_members").insert({
      vault_id: inv.vault_id, user_id: userId, role: "editor",
    });
    if (error && error.code !== "23505") throw new DataError(error.message, 500);
  }

  // Mark invite consumed.  Don't fail if the update misses (race).
  await svc.from("vault_invites").update({ used_at: new Date().toISOString(), used_by: userId }).eq("id", inv.id);

  const { data: vault } = await svc
    .from("vaults").select("id, name, owner_id, created_at")
    .eq("id", inv.vault_id).single();
  if (!vault) throw new DataError("Vault not found", 404);
  return {
    vault: { id: vault.id, name: vault.name, ownerId: vault.owner_id, createdAt: vault.created_at },
    alreadyMember,
  };
}
