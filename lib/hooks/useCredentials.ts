"use client";

import { useCallback, useEffect, useState } from "react";
import { credentialsApi } from "@/lib/api-client";
import { decryptString, encryptString } from "@/lib/crypto";
import type { CredentialDecrypted, CredentialRecord } from "@/lib/types";

interface NewCredentialPlain {
  service: string;
  url?: string | null;
  username: string;
  password: string;
  notes?: string | null;
  twoFactor: boolean;
  strength: "weak" | "medium" | "strong" | null;
  tags: string[];
  pinned: boolean;
  /** Plaintext owner id from CREDENTIAL_OWNERS, or null for shared
   *  / unassigned.  See lib/credentials-owners.ts. */
  owner?: string | null;
}

async function decryptRecord(rec: CredentialRecord, key: CryptoKey): Promise<CredentialDecrypted> {
  const username = await decryptString(key, rec.usernameEncrypted, rec.ivUsername);
  // Password ciphertext is nullable now (SSO / passkey / email-link
  // accounts).  Empty string for the UI means "no password stored";
  // CredentialRow + the print sheet check the empty case and hide
  // the masked dots + copy chip.
  let password = "";
  if (rec.passwordEncrypted && rec.ivPassword) {
    password = await decryptString(key, rec.passwordEncrypted, rec.ivPassword);
  }
  let notes: string | null = null;
  if (rec.notesEncrypted && rec.ivNotes) {
    try {
      notes = await decryptString(key, rec.notesEncrypted, rec.ivNotes);
    } catch {
      notes = "[не удалось расшифровать]";
    }
  }
  return {
    id: rec.id,
    service: rec.service,
    url: rec.url,
    username, password, notes,
    twoFactor: rec.twoFactor,
    strength: rec.strength,
    tags: rec.tags,
    pinned: rec.pinned,
    owner: rec.owner ?? null,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

async function encryptForCreate(input: NewCredentialPlain, key: CryptoKey) {
  const u = await encryptString(key, input.username);
  // Only run AES-GCM on a non-empty password.  Encrypting "" would
  // burn a fresh IV on nothing useful and would force consumers to
  // always decrypt before checking "is there even a password" —
  // null/null is cheaper to recognise.
  const p = input.password ? await encryptString(key, input.password) : null;
  const n = input.notes ? await encryptString(key, input.notes) : null;
  return {
    service: input.service,
    url: input.url ?? null,
    usernameEncrypted: u.ciphertext,
    ivUsername: u.iv,
    passwordEncrypted: p?.ciphertext ?? null,
    ivPassword: p?.iv ?? null,
    notesEncrypted: n?.ciphertext ?? null,
    ivNotes: n?.iv ?? null,
    twoFactor: input.twoFactor,
    // Strength is meaningless when there's no password to evaluate.
    strength: input.password ? (input.strength ?? undefined) : undefined,
    tags: input.tags,
    pinned: input.pinned,
    owner: input.owner ?? null,
  };
}

export function useCredentials(key: CryptoKey | null) {
  const [items, setItems] = useState<CredentialDecrypted[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!key) { setItems([]); setLoading(false); return; }
    try {
      setLoading(true);
      const { items: rows } = await credentialsApi.list();
      const decrypted = await Promise.all(rows.map((r) => decryptRecord(r, key)));
      // Sort: pinned first, then most recently updated
      decrypted.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      setItems(decrypted);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { refetch(); }, [refetch]);

  const create = useCallback(async (input: NewCredentialPlain) => {
    if (!key) throw new Error("Vault locked");
    const payload = await encryptForCreate(input, key);
    const created = await credentialsApi.create(payload);
    const dec = await decryptRecord(created, key);
    setItems((prev) => [dec, ...prev].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    }));
    return dec;
  }, [key]);

  /**
   * Full-record edit.  Same payload shape as create — we re-encrypt
   * every field with fresh IVs because the password may have rotated,
   * and AES-GCM forbids reusing an IV with the same key (a leak would
   * unmask both ciphertexts).  The server's PATCH route accepts any
   * subset of CreateCredentialInput via updateCredentialSchema.partial,
   * so sending the full re-encrypted blob is safe.
   */
  const update = useCallback(async (id: string, input: NewCredentialPlain) => {
    if (!key) throw new Error("Vault locked");
    const payload = await encryptForCreate(input, key);
    const updated = await credentialsApi.update(id, payload);
    const dec = await decryptRecord(updated, key);
    setItems((prev) => prev.map((it) => (it.id === id ? dec : it)).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    }));
    return dec;
  }, [key]);

  const togglePin = useCallback(async (id: string) => {
    const target = items.find((it) => it.id === id);
    if (!target) return;
    const newPinned = !target.pinned;
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, pinned: newPinned } : it))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      }));
    try {
      await credentialsApi.update(id, { pinned: newPinned });
    } catch (e) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, pinned: !newPinned } : it)));
      throw e;
    }
  }, [items]);

  const remove = useCallback(async (id: string) => {
    const snapshot = items;
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      await credentialsApi.delete(id);
    } catch (e) {
      setItems(snapshot);
      throw e;
    }
  }, [items]);

  return { items, loading, error, refetch, create, update, togglePin, remove };
}
