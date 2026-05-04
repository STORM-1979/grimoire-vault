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
}

async function decryptRecord(rec: CredentialRecord, key: CryptoKey): Promise<CredentialDecrypted> {
  const username = await decryptString(key, rec.usernameEncrypted, rec.ivUsername);
  const password = await decryptString(key, rec.passwordEncrypted, rec.ivPassword);
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
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

async function encryptForCreate(input: NewCredentialPlain, key: CryptoKey) {
  const u = await encryptString(key, input.username);
  const p = await encryptString(key, input.password);
  const n = input.notes ? await encryptString(key, input.notes) : null;
  return {
    service: input.service,
    url: input.url ?? null,
    usernameEncrypted: u.ciphertext,
    ivUsername: u.iv,
    passwordEncrypted: p.ciphertext,
    ivPassword: p.iv,
    notesEncrypted: n?.ciphertext ?? null,
    ivNotes: n?.iv ?? null,
    twoFactor: input.twoFactor,
    strength: input.strength ?? undefined,
    tags: input.tags,
    pinned: input.pinned,
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

  return { items, loading, error, refetch, create, togglePin, remove };
}
