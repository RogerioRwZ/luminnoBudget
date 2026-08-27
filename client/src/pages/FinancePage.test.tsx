// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  setLocation: vi.fn(),
  overview: { data: undefined as any, isLoading: false, error: null as Error | null },
}));

const loadedOverview = {
  receivables: [{ id: 9, quoteId: 3, quoteNumber: 18, clientId: null, clientName: "Clínica Aurora", description: "Orçamento #18", installmentNumber: 1, installmentCount: 2, originalAmount: 300, dueDate: new Date("2026-09-10T12:00:00Z"), status: "open", receivedAmount: 0, remainingAmount: 300, overdue: false, payments: [] }],
  totals: { expected: 300, received: 0, outstanding: 300, overdueAmount: 0, overdueCount: 0, receivedThisMonth: 0 },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ finance: { invalidate: mocks.invalidate }, dashboard: { invalidate: mocks.invalidate } }),
    finance: {
      overview: { useQuery: () => ({ ...mocks.overview, refetch: mocks.refetch }) },
      clients: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      recordPayment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      cancel: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/financeiro", mocks.setLocation] }));

import FinancePage from "./FinancePage";

afterEach(() => {
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetch.mockReset();
  mocks.overview = { data: undefined, isLoading: false, error: null };
});

describe("FinancePage", () => {
  it("lista a cobrança e abre o recebimento com o saldo preenchido", () => {
    mocks.overview.data = loadedOverview;
    render(<FinancePage />);
    expect(screen.getByText("Clínica Aurora")).toBeTruthy();
    expect(screen.getAllByText(/R\$\s*300,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Receber" }));
    expect(screen.getAllByText("Registrar recebimento").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("300.00")).toBeTruthy();
  });

  it("nomeia os filtros e os selects dos diálogos", () => {
    mocks.overview.data = loadedOverview;
    const { container } = render(<FinancePage />);
    expect(screen.getByRole("combobox", { name: "Filtrar cobranças por status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nova cobrança" }));
    expect(screen.getByRole("combobox", { name: "Cliente cadastrado" })).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });

  it("informa o carregamento e o estado vazio", () => {
    mocks.overview.isLoading = true;
    const { rerender } = render(<FinancePage />);
    expect(screen.getByText("Carregando financeiro…")).toBeTruthy();
    mocks.overview.isLoading = false;
    rerender(<FinancePage />);
    expect(screen.getByText("Nenhuma cobrança encontrada.")).toBeTruthy();
  });

  it("oferece nova tentativa quando a consulta falha", () => {
    mocks.overview.error = new Error("indisponível");
    render(<FinancePage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar as cobranças.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
