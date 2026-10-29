// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  statement: vi.fn(),
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  list: { data: undefined as any, isLoading: false, error: null as Error | null },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ customers: { list: { invalidate: mocks.invalidate } } }),
    customers: {
      list: { useQuery: () => ({ ...mocks.list, refetch: mocks.refetch }) },
      save: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      statement: { useQuery: (input: { id: number }, options: { enabled: boolean }) => (options.enabled ? mocks.statement(input) : { data: undefined, isLoading: false, error: null }) },
    },
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/clientes", mocks.setLocation] }));

import CustomersPage from "./CustomersPage";

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetch.mockReset();
  mocks.list = { data: undefined, isLoading: false, error: null };
});

describe("CustomersPage", () => {
  it("nomeia os campos do cadastro de cliente", () => {
    const { container } = render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    expect(screen.getByLabelText("Nome do cliente *")).toBeTruthy();
    expect(screen.getByLabelText("Profissional responsável *")).toBeTruthy();
    expect(screen.getByLabelText("Endereço")).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });

  it("informa carregamento e lista vazia", () => {
    mocks.list.isLoading = true;
    const { rerender } = render(<CustomersPage />);
    expect(screen.getByText("Carregando clientes…")).toBeTruthy();
    mocks.list.isLoading = false;
    rerender(<CustomersPage />);
    expect(screen.getByText("Nenhum cliente cadastrado.")).toBeTruthy();
  });

  it("informa falha e permite tentar novamente", () => {
    mocks.list.error = new Error("indisponível");
    render(<CustomersPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar os clientes.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("abre a ficha do cliente com totais e navega até o orçamento", () => {
    mocks.list = { data: [{ id: 5, name: "Marina", professional: "Arq. Paulo", phone: "(11) 98888-7777", quoteCount: 1 }] as any, isLoading: false, error: null };
    mocks.statement.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        quotes: [{ id: 42, quoteNumber: 12, status: "approved", issueDate: new Date(2026, 4, 3), total: 1500 }],
        totals: { quoted: 1500, approved: 1500, received: 500, outstanding: 1000, overdue: 0, conversionRate: 1 },
      },
    });
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: /Histórico/ }));
    expect(mocks.statement).toHaveBeenCalledWith({ id: 5 });
    expect(screen.getByText("Ficha de Marina")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByRole("link", { name: /WhatsApp/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\d+$/);
    fireEvent.click(screen.getByRole("button", { name: /Orçamento #12/ }));
    expect(mocks.setLocation).toHaveBeenCalledWith("/orcamentos/42");
  });
});
