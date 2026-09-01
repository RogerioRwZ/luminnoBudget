// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invalidate: vi.fn(), mutate: vi.fn(), refetch: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ invalidate: mocks.invalidate, settings: { get: { invalidate: mocks.invalidate } }, dashboard: { invalidate: mocks.invalidate } }),
    settings: {
      get: { useQuery: () => ({ data: undefined }) },
      save: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      uploadLogo: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
    backup: {
      export: { useQuery: () => ({ isFetching: false, refetch: mocks.refetch }) },
      import: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
  },
}));

import SettingsPage from "./SettingsPage";

afterEach(() => {
  cleanup();
  mocks.invalidate.mockReset();
  mocks.mutate.mockReset();
  mocks.refetch.mockReset();
});

describe("SettingsPage", () => {
  it("atribui nomes acessíveis aos campos agrupados e aos controles especiais", () => {
    const { container } = render(<SettingsPage />);

    expect(screen.getByLabelText("Razão social / nome da empresa")).toBeTruthy();
    expect(screen.getByLabelText("Chave PIX")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Tipo de desconto PIX" })).toBeTruthy();
    expect(screen.getByLabelText("Dias de antecedência do alerta")).toBeTruthy();
    expect(screen.getByLabelText("Observações comerciais padrão")).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });
});
