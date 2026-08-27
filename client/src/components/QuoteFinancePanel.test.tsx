// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trpc", () => ({ trpc: { finance: { byQuote: { useQuery: () => ({ data: [{ id: 1, installmentNumber: 1, installmentCount: 2, dueDate: new Date("2026-09-01T12:00:00Z"), status: "partial", receivedAmount: 50, remainingAmount: 100 }], isLoading: false }) } } } }));
vi.mock("wouter", () => ({ useLocation: () => ["/orcamentos/3", vi.fn()] }));
import { QuoteFinancePanel } from "./QuoteFinancePanel";

describe("QuoteFinancePanel", () => {
  it("mostra saldo e status das parcelas vinculadas ao orçamento", () => {
    render(<QuoteFinancePanel quoteId={3} quoteStatus="approved"/>);
    expect(screen.getByText("Controle de pagamentos")).toBeTruthy();
    expect(screen.getByText(/R\$\s*50,00/)).toBeTruthy();
    expect(screen.getByText(/R\$\s*100,00/)).toBeTruthy();
    expect(screen.getByText("Parcial")).toBeTruthy();
  });
});
