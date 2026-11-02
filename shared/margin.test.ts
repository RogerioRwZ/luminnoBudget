import { describe, expect, it } from "vitest";
import { discountPercent, percentLabel, quoteMargin } from "./margin";

describe("margem do orçamento", () => {
  it("calcula sobre a mercadoria depois do desconto e separa itens sem custo", () => {
    const result = quoteMargin([
      { quantity: 2, unitPrice: 100, unitCost: 40 },
      { quantity: 1, unitPrice: 50, unitCost: null },
    ], 25);
    // Desconto de 25 sobre 250 = fator 0,9: receita 225; com custo, 180 contra 80.
    expect(result).toMatchObject({ revenue: 225, coveredRevenue: 180, cost: 80, profit: 100, missingCost: 1 });
    expect(result.margin).toBeCloseTo(100 / 180, 5);
  });

  it("sem itens com custo não inventa margem", () => {
    expect(quoteMargin([{ quantity: 1, unitPrice: 10, unitCost: undefined }], 0).margin).toBeNull();
    expect(quoteMargin([], 0)).toMatchObject({ revenue: 0, margin: null, missingCost: 0 });
  });

  it("custo zero conta como custo conhecido", () => {
    expect(quoteMargin([{ quantity: 1, unitPrice: 10, unitCost: 0 }], 0).margin).toBe(1);
  });

  it("percentual de desconto e rótulos", () => {
    expect(discountPercent(200, 30)).toBe(15);
    expect(discountPercent(0, 30)).toBe(0);
    expect(percentLabel(0.3456)).toBe("34,6%");
    expect(percentLabel(null)).toBe("—");
  });
});
