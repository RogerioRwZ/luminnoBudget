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
  // Estado "limpo" do formulário (o que veio do servidor), em JSON. Sem ele,
  // o valor do momento em que o autosave é habilitado vira a referência.
  pristineFingerprint?: string | null;
};

const STORAGE_PREFIX = "luminno:draft:";

// Rascunhos ficam separados por usuário: no mesmo computador, uma pessoa
// não vê nem recupera o rascunho de outra.
let draftOwner = "anon";
export function setDraftOwner(owner: string | number | null | undefined) {
  draftOwner = owner === null || owner === undefined ? "anon" : String(owner);
}

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${draftOwner}:${key}`;
}

export function removeDraft(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // armazenamento indisponível (modo privado, cota): nada a limpar
  }
}

const fingerprint = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

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
    pristineFingerprint,
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

  // Referência do formulário "sem alterações": só há rascunho quando o
  // valor muda em relação a ela (abrir uma tela não cria rascunho).
  const capturedBaseline = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      capturedBaseline.current = null;
      return;
    }
    if (capturedBaseline.current === null) capturedBaseline.current = fingerprint(value);
  }, [enabled, value]);
  const baseline = pristineFingerprint ?? capturedBaseline.current;

  useEffect(() => {
    if (!enabled || !recoveryHandled || typeof window === "undefined") return;
    const current = fingerprint(value);
    const reference = pristineFingerprint ?? capturedBaseline.current ?? current;
    if (current === reference) {
      removeDraft(key);
      setStatus("idle");
      return;
    }
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
  }, [delay, enabled, key, recoveryHandled, value, pristineFingerprint]);

  const restore = () => {
    if (!recovery) return null;
    setRecoveryHandled(true);
    setStatus("saved");
    return recovery.value;
  };

  const discard = () => {
    removeDraft(key);
    setRecovery(null);
    setRecoveryHandled(true);
    setStatus("idle");
  };

  const clear = () => {
    removeDraft(key);
    setRecovery(null);
    setStatus("idle");
  };

  return {
    status,
    recovery,
    // Um rascunho igual ao que já está salvo não é "alteração não salva".
    hasRecovery:
      Boolean(recovery) &&
      !recoveryHandled &&
      (baseline === null || fingerprint(recovery!.value) !== baseline),
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
