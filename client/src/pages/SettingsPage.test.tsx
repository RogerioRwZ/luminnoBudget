// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
  settingsError: null as Error | null,
  // Objeto estável (mesma referência entre renders) — do contrário o
  // useEffect de sincronização do formulário, que depende de `data` por
  // referência, entraria em loop infinito a cada chamada do mock.
  settingsData: {
    companyName: "Luminno Iluminação",
    tradingName: "Luminno",
    logoUrl: null,
    document: null,
    address: null,
    phone: null,
    email: null,
    pixKey: null,
    pixRecipient: null,
    defaultPixDiscountMode: "percentage",
    defaultPixDiscountValue: "0",
    defaultInstallments: 6,
    alertThresholdDays: 3,
    defaultTerms: null,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ invalidate: mocks.invalidate, settings: { get: { invalidate: mocks.invalidate } }, dashboard: { invalidate: mocks.invalidate } }),
    settings: {
      get: {
        useQuery: () => ({
          isLoading: false,
          error: mocks.settingsError,
          refetch: mocks.refetch,
          data: mocks.settingsError ? undefined : mocks.settingsData,
        }),
      },
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
  mocks.settingsError = null;
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

  it("não exibe o formulário (em branco) quando as configurações falham ao carregar, evitando salvar por cima das reais", () => {
    mocks.settingsError = new Error("falha de rede");
    render(<SettingsPage />);

    // Nenhum campo do formulário deve estar acessível — o risco é o usuário
    // digitar/salvar em cima de um formulário vazio, apagando as
    // configurações reais da empresa.
    expect(screen.queryByLabelText("Razão social / nome da empresa")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível carregar as configurações"
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
