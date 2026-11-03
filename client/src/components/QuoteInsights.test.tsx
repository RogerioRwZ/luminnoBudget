// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QuoteMarginPanel, StockShortageHint } from "./QuoteInsights";

afterEach(cleanup);

describe("avisos do orçamento", () => {
  it("mostra o saldo livre quando não atende a quantidade", () => {
    render(<StockShortageHint productId={1} unit="UN" needed={4} availability={new Map([[1, 1]])} />);
    expect(screen.getByRole("status").textContent).toContain("Só 1 UN livre em estoque para 4 UN");
  });

  it("não avisa produto sem saldo, que a loja vende sob encomenda", () => {
    const { container } = render(<StockShortageHint productId={9} unit="UN" needed={1} availability={new Map()} />);
    expect(container.textContent).toBe("");
  });

  it("avisa desconto acima do limite e margem baixa só para quem vê custo", () => {
    const props = { items: [{ quantity: 1, unitPrice: 100, unitCost: 80 }], productsSubtotal: 100, discountAmount: 15, maxDiscountPercent: 10, minMarginPercent: 20 };
    const { rerender } = render(<QuoteMarginPanel {...props} showCost />);
    expect(screen.getByText(/passa do limite de 10%/)).toBeTruthy();
    expect(screen.getByText("5,9%")).toBeTruthy();
    expect(screen.getByText(/Abaixo da margem mínima de 20%/)).toBeTruthy();
    rerender(<QuoteMarginPanel {...props} showCost={false} />);
    expect(screen.queryByText(/Margem/)).toBeNull();
    expect(screen.getByText(/passa do limite/)).toBeTruthy();
  });
});
