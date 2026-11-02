// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteMarginPanel, StockShortageHint } from "./QuoteInsights";

afterEach(cleanup);

const member = (id: number, color: string, temperature: string) => ({ id, code: `S${id}`, shortDescription: `Spot — ${color} · ${temperature}`, imageUrl: null, unit: "UN", unitPrice: "89.90", attributes: JSON.stringify({ color, colorTemperature: temperature }) });

describe("avisos do orçamento", () => {
  it("sugere outra variação com estoque e troca ao clicar", () => {
    const onSwap = vi.fn();
    const family = [member(1, "Preto", "3000K"), member(2, "Preto", "4000K"), member(3, "Branco", "3000K")];
    render(<StockShortageHint productId={1} attributes={family[0]!.attributes} unit="UN" needed={4} availability={new Map([[1, 1], [2, 10], [3, 2]])} family={family} onSwap={onSwap} />);
    expect(screen.getByRole("status").textContent).toContain("Só 1 UN livre em estoque para 4 UN");
    expect(screen.queryByRole("button", { name: /Branco/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Preto · 4000K \(10\)/ }));
    expect(onSwap).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("não avisa produto sem variações que a loja vende sob encomenda", () => {
    const { container } = render(<StockShortageHint productId={9} attributes={null} unit="UN" needed={1} availability={new Map()} family={[member(9, "Preto", "3000K")]} onSwap={vi.fn()} />);
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
