// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftStatusLabel,
  readDraft,
  useDraftAutosave,
} from "./useDraftAutosave";

const key = "luminno:draft:test";
const storage = new Map<string, string>();
const localStore = {
  getItem: (name: string) => storage.get(name) ?? null,
  setItem: (name: string, value: string) => storage.set(name, value),
  removeItem: (name: string) => storage.delete(name),
  clear: () => storage.clear(),
};

describe("useDraftAutosave", () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", localStore);
    window.localStorage = localStore as Storage;
    vi.useRealTimers();
  });

  it("salva após o debounce e permite limpar o rascunho", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDraftAutosave("test", value, { delay: 100 }),
      { initialProps: { value: { name: "Inicial" } } }
    );

    rerender({ value: { name: "Atualizado" } });
    expect(localStorage.getItem(key)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(readDraft<{ name: string }>("test")?.value.name).toBe("Atualizado");
    act(() => result.current.clear());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("expira rascunhos antigos e informa os estados em português", () => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        savedAt: Date.now() - 10_000,
        value: { name: "antigo" },
      })
    );
    expect(readDraft("test", 1)).toBeNull();
    expect(draftStatusLabel("waiting")).toBe("Salvando em instantes…");
    expect(draftStatusLabel("saving")).toBe("Salvando…");
    expect(draftStatusLabel("saved")).toBe("Salvo agora");
    expect(draftStatusLabel("error")).toContain("rascunho local");
  });
});
