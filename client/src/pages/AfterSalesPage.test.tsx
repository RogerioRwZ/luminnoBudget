// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date;
};
const base = { quoteId: 5, quoteItemId: 9, productId: 3, supplierName: "Lumi", reason: "defect", description: null, resolution: null, refundAmount: null, restockMovementId: null, replacementMovementId: null, openedAt: day(-3), resolvedAt: null, quoteNumber: 12 };
const mocks = vi.hoisted(() => ({ cases: [] as unknown[], role: "stock" }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ afterSales: { invalidate: vi.fn() }, summary: { today: { invalidate: vi.fn() } }, inventory: { invalidate: vi.fn() } }),
    auth: { me: { useQuery: () => ({ data: { role: mocks.role } }) } },
    afterSales: {
      list: { useQuery: () => ({ data: mocks.cases, isLoading: false, error: null, refetch: vi.fn() }) },
      report: { useQuery: () => ({ data: undefined, isLoading: false }) },
      sales: { useQuery: () => ({ data: [], isLoading: false }) },
      items: { useQuery: () => ({ data: undefined, error: null }) },
      create: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
  },
}));

import AfterSalesPage from "./AfterSalesPage";

afterEach(() => {
  cleanup();
  mocks.cases = [];
});

describe("AfterSalesPage", () => {
  it("lista as ocorrências em andamento e destaca o prazo vencido", () => {
    mocks.cases = [
      { ...base, id: 1, type: "exchange", status: "open", clientName: "Ana", productDescription: "Spot Orbit", quantity: 2, dueDate: day(-1), active: true, overdue: true },
      { ...base, id: 2, type: "return", status: "resolved", clientName: "Bruno", productDescription: "Fita LED", quantity: 1, dueDate: day(-2), active: false, overdue: false, resolution: "Reembolsado" },
    ];
    render(<AfterSalesPage />);
    expect(screen.getByText("Troca #1")).toBeTruthy();
    expect(screen.getByText("Prazo vencido", { selector: "span,div" })).toBeTruthy();
    // Resolvidas ficam fora do filtro padrão.
    expect(screen.queryByText("Devolução #2")).toBeNull();
    // Expedição não abre orçamentos: o número aparece sem link.
    expect(screen.queryByRole("link", { name: /orçamento #12/ })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Buscar por cliente, produto ou orçamento"), { target: { value: "fita" } });
    expect(screen.queryByText("Troca #1")).toBeNull();
  });

  it("mostra o convite quando não há ocorrências", () => {
    render(<AfterSalesPage />);
    expect(screen.getByText(/Nenhuma ocorrência de pós-venda ainda/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Nova ocorrência/ })).toBeTruthy();
  });
});
