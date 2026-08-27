// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn(), setLocation: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ finance: { invalidate: mocks.invalidate }, dashboard: { invalidate: mocks.invalidate } }),
    finance: {
      overview: { useQuery: () => ({ data: { receivables: [{ id: 9, quoteId: 3, quoteNumber: 18, clientId: null, clientName: "Clínica Aurora", description: "Orçamento #18", installmentNumber: 1, installmentCount: 2, originalAmount: 300, dueDate: new Date("2026-09-10T12:00:00Z"), status: "open", receivedAmount: 0, remainingAmount: 300, overdue: false, payments: [] }], totals: { expected: 300, received: 0, outstanding: 300, overdueAmount: 0, overdueCount: 0, receivedThisMonth: 0 } }, isLoading: false }) },
      clients: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      recordPayment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      cancel: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/financeiro", mocks.setLocation] }));

import FinancePage from "./FinancePage";

describe("FinancePage", () => {
  it("lista a cobrança e abre o recebimento com o saldo preenchido", () => {
    render(<FinancePage />);
    expect(screen.getByText("Clínica Aurora")).toBeTruthy();
    expect(screen.getAllByText(/R\$\s*300,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Receber" }));
    expect(screen.getAllByText("Registrar recebimento").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("300.00")).toBeTruthy();
  });
});
