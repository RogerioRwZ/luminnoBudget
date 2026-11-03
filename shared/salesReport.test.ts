import { describe, expect, it } from "vitest";
import { buildSalesReport, withoutCost } from "./salesReport";

const quote = (id: number, seller: string, professional: string, items: Array<{ productId: number | null; quantity: number; unitPrice: number; unitCost: number | null }>, discountAmount = 0, shipping = 0) => {
  const productsSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return {
    id, quoteNumber: id, approvedAt: new Date("2026-10-10T12:00:00Z"), clientName: `Cliente ${id}`, professional, sellerName: seller,
    total: productsSubtotal - discountAmount + shipping, shipping, productsSubtotal, discountAmount,
    items: items.map((item) => ({ ...item, code: item.productId ? `P${item.productId}` : "", shortDescription: item.productId ? `Produto ${item.productId}` : "Instalação", unit: "UN" })),
  };
};

describe("relatório de vendas", () => {
  const report = buildSalesReport([
    quote(1, "Carla", "Ana Souza", [{ productId: 1, quantity: 2, unitPrice: 100, unitCost: 50 }, { productId: null, quantity: 1, unitPrice: 100, unitCost: null }], 30, 15),
    quote(2, "Carla", " ana souza", [{ productId: 2, quantity: 1, unitPrice: 200, unitCost: 80 }]),
    quote(3, "", "", [{ productId: 3, quantity: 10, unitPrice: 10, unitCost: 4 }]),
  ]);

  it("soma por vendedor, profissional e produto", () => {
    expect(report.totals).toMatchObject({ quotes: 3, total: 585, shipping: 15, revenue: 570, linesWithoutCost: 1 });
    expect(report.bySeller.map((row) => [row.label, row.quotes, row.revenue])).toEqual([["Carla", 2, 470], ["Não identificado", 1, 100]]);
    expect(report.byProfessional.map((row) => [row.label, row.quotes])).toEqual([["Ana Souza", 2], ["Sem profissional", 1]]);
    // O desconto de 30 em 300 (fator 0,9) é dividido entre os itens do orçamento 1.
    expect(report.byProduct.find((row) => row.key === "product-1")).toMatchObject({ quotes: 1, quantity: 2, revenue: 180, cost: 100, profit: 80 });
    expect(report.bySeller.find((row) => row.label === "Carla")).toMatchObject({ revenue: 470 });
    expect(report.byProduct).toHaveLength(4);
    expect(report.lines).toHaveLength(4);
  });

  it("margem ignora itens sem custo", () => {
    // Com custo: 180 + 200 + 100 = 480 de receita contra 100 + 80 + 40 = 220.
    expect(report.totals.cost).toBe(220);
    expect(report.totals.margin).toBeCloseTo(260 / 480, 5);
  });

  it("tira custo e margem para quem não pode ver", () => {
    const stripped = withoutCost(report);
    expect(stripped.totals.margin).toBeNull();
    expect(stripped.bySeller.every((row) => row.cost === 0 && row.margin === null)).toBe(true);
    expect(stripped.lines.every((line) => line.unitCost === null && line.cost === null)).toBe(true);
    expect(stripped.totals.revenue).toBe(570);
  });
});
