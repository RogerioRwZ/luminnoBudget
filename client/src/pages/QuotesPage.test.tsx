// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetch: vi.fn(),
  setLocation: vi.fn(),
  listPaged: {
    data: { quotes: [] as any[], total: 0, page: 1, pageSize: 25, totalPages: 1 },
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    quote: {
      listPaged: { useQuery: () => ({ ...mocks.listPaged, refetch: mocks.refetch }) },
      create: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      duplicate: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/orcamentos", mocks.setLocation] }));

import QuotesPage from "./QuotesPage";

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.refetch.mockReset();
  mocks.setLocation.mockReset();
  mocks.listPaged = { data: { quotes: [], total: 0, page: 1, pageSize: 25, totalPages: 1 }, isLoading: false, error: null };
});

describe("QuotesPage", () => {
  it("identifica a busca e apresenta o estado vazio", () => {
    const { container } = render(<QuotesPage />);
    expect(screen.getByLabelText("Buscar por número, cliente ou profissional")).toBeTruthy();
    expect(screen.getByText("Nenhum orçamento encontrado.")).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });

  it("informa o carregamento da lista", () => {
    mocks.listPaged.isLoading = true;
    render(<QuotesPage />);
    expect(screen.getByText("Carregando orçamentos…")).toBeTruthy();
  });

  it("informa falha e permite tentar novamente", () => {
    mocks.listPaged.error = new Error("indisponível");
    render(<QuotesPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar os orçamentos.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("mostra os controles de página quando há mais de uma página, e avança ao clicar em Próxima", () => {
    mocks.listPaged.data = { quotes: [], total: 60, page: 1, pageSize: 25, totalPages: 3 };
    render(<QuotesPage />);

    expect(screen.getByText("Página 1 de 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 2 de 3")).toBeTruthy();
  });

  it("não pagina quando cabe tudo em uma página só", () => {
    mocks.listPaged.data = { quotes: [], total: 3, page: 1, pageSize: 25, totalPages: 1 };
    render(<QuotesPage />);
    expect(screen.queryByText(/Página \d+ de \d+/)).toBeNull();
  });
});
