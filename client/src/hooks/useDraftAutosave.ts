import { useEffect, useRef, useState } from "react";

export type DraftAutosaveStatus =
  | "idle"
  | "waiting"
  | "saving"
  | "saved"
  | "error";

type StoredDraft<T> = {
  version: 1;
  savedAt: number;
  value: T;
};

type Options<T> = {
  delay?: number;
  maxAge?: number;
  enabled?: boolean;
  onSave?: (value: T) => void | Promise<void>;
};

const STORAGE_PREFIX = "luminno:draft:";

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

export function readDraft<T>(
  key: string,
  maxAge = 7 * 24 * 60 * 60 * 1000
): { value: T; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft<T>>;
    if (
      parsed.version !== 1 ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > maxAge
    ) {
      window.localStorage.removeItem(storageKey(key));
      return null;
    }
    return { value: parsed.value as T, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function useDraftAutosave<T>(
  key: string,
  value: T,
  options: Options<T> = {}
) {
  const {
    delay = 900,
    maxAge = 7 * 24 * 60 * 60 * 1000,
    enabled = true,
    onSave,
  } = options;
  const onSaveRef = useRef(onSave);
  const [status, setStatus] = useState<DraftAutosaveStatus>("idle");
  const [recovery, setRecovery] = useState<{
    value: T;
    savedAt: number;
  } | null>(() => readDraft<T>(key, maxAge));
  const [recoveryHandled, setRecoveryHandled] = useState(
    () => !Boolean(readDraft<T>(key, maxAge))
  );

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const stored = readDraft<T>(key, maxAge);
    setRecovery(stored);
    setRecoveryHandled(!stored);
    setStatus("idle");
  }, [key, maxAge]);

  useEffect(() => {
    if (!enabled || !recoveryHandled || typeof window === "undefined") return;
    setStatus("waiting");
    const timer = window.setTimeout(async () => {
      setStatus("saving");
      try {
        const payload: StoredDraft<T> = {
          version: 1,
          savedAt: Date.now(),
          value,
        };
        window.localStorage.setItem(storageKey(key), JSON.stringify(payload));
        await onSaveRef.current?.(value);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delay, enabled, key, recoveryHandled, value]);

  const restore = () => {
    if (!recovery) return null;
    setRecoveryHandled(true);
    setStatus("saved");
    return recovery.value;
  };

  const discard = () => {
    if (typeof window !== "undefined")
      window.localStorage.removeItem(storageKey(key));
    setRecovery(null);
    setRecoveryHandled(true);
    setStatus("idle");
  };

  const clear = () => {
    if (typeof window !== "undefined")
      window.localStorage.removeItem(storageKey(key));
    setRecovery(null);
    setStatus("idle");
  };

  return {
    status,
    recovery,
    hasRecovery: Boolean(recovery) && !recoveryHandled,
    restore,
    discard,
    clear,
  };
}

export function draftStatusLabel(status: DraftAutosaveStatus) {
  if (status === "waiting") return "Salvando em instantes…";
  if (status === "saving") return "Salvando…";
  if (status === "saved") return "Salvo agora";
  if (status === "error") return "Não foi possível salvar o rascunho local";
  return "";
}
