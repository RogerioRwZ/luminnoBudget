// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetch: vi.fn(),
  setLocation: vi.fn(),
  list: { data: undefined as any, isLoading: false, error: null as Error | null },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    quote: {
      list: { useQuery: () => ({ ...mocks.list, refetch: mocks.refetch }) },
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
  mocks.list = { data: undefined, isLoading: false, error: null };
});

describe("QuotesPage", () => {
  it("identifica a busca e apresenta o estado vazio", () => {
    const { container } = render(<QuotesPage />);
    expect(screen.getByLabelText("Buscar por número, cliente ou profissional")).toBeTruthy();
    expect(screen.getByText("Nenhum orçamento encontrado.")).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });

  it("informa o carregamento da lista", () => {
    mocks.list.isLoading = true;
    render(<QuotesPage />);
    expect(screen.getByText("Carregando orçamentos…")).toBeTruthy();
  });

  it("informa falha e permite tentar novamente", () => {
    mocks.list.error = new Error("indisponível");
    render(<QuotesPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar os orçamentos.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
