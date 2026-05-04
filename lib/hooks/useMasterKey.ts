"use client";

import { useCallback, useEffect, useState } from "react";
import {
  base64ToBytes,
  bytesToBase64,
  deriveKey,
  exportKeyRaw,
  forgetKey,
  generateSalt,
  importKeyRaw,
  loadStashedKey,
  makeVerificationCiphertext,
  stashKey,
  verifyKey,
} from "@/lib/crypto";
import { createClient } from "@/lib/supabase/client";

interface VaultMeta {
  salt: string;            // base64
  verifyCt: string;        // base64
  verifyIv: string;        // base64
  iterations: number;
}

interface UseMasterKeyResult {
  ready: boolean;          // hook initialised, vault meta loaded
  isSetup: boolean;        // master password ever set
  unlocked: boolean;       // CryptoKey loaded in memory
  busy: boolean;           // mid-derivation
  key: CryptoKey | null;
  error: string | null;
  setup: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  reset: () => Promise<void>;
}

const META_KEY = "credentials_vault_v1";

export function useMasterKey(): UseMasterKeyResult {
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<VaultMeta | null>(null);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load vault meta + restore stashed key on mount
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const m = (user?.user_metadata?.[META_KEY] ?? null) as VaultMeta | null;
        setMeta(m);

        if (m) {
          const stashed = loadStashedKey();
          if (stashed) {
            try {
              const restored = await importKeyRaw(stashed);
              if (await verifyKey(restored, m.verifyCt, m.verifyIv)) {
                setKey(restored);
              } else {
                forgetKey();
              }
            } catch {
              forgetKey();
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить vault metadata");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setup = useCallback(async (password: string) => {
    setBusy(true); setError(null);
    try {
      if (password.length < 10) throw new Error("Master password — минимум 10 символов");
      const salt = await generateSalt();
      const derived = await deriveKey(password, salt);
      const verify = await makeVerificationCiphertext(derived);
      const newMeta: VaultMeta = {
        salt: bytesToBase64(salt),
        verifyCt: verify.ciphertext,
        verifyIv: verify.iv,
        iterations: 600_000,
      };
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ data: { [META_KEY]: newMeta } });
      if (error) throw new Error(error.message);
      const raw = await exportKeyRaw(derived);
      stashKey(raw);
      setMeta(newMeta);
      setKey(derived);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось установить master password");
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const unlock = useCallback(async (password: string) => {
    setBusy(true); setError(null);
    try {
      if (!meta) throw new Error("Vault не настроен");
      const salt = base64ToBytes(meta.salt);
      const derived = await deriveKey(password, salt, meta.iterations);
      const ok = await verifyKey(derived, meta.verifyCt, meta.verifyIv);
      if (!ok) throw new Error("Неверный master password");
      const raw = await exportKeyRaw(derived);
      stashKey(raw);
      setKey(derived);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось разблокировать");
      throw e;
    } finally {
      setBusy(false);
    }
  }, [meta]);

  const lock = useCallback(() => {
    forgetKey();
    setKey(null);
  }, []);

  const reset = useCallback(async () => {
    forgetKey();
    setKey(null);
    setMeta(null);
    const supabase = createClient();
    await supabase.auth.updateUser({ data: { [META_KEY]: null } });
  }, []);

  return {
    ready,
    isSetup: !!meta,
    unlocked: !!key,
    busy,
    key,
    error,
    setup,
    unlock,
    lock,
    reset,
  };
}
