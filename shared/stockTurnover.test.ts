import { describe, expect, it } from "vitest";
import { abcCurve, staleStock, type StaleStockInput } from "./stockTurnover";

const now = new Date(2026, 10, 3, 12);
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);
const product = (overrides: Partial<StaleStockInput>): StaleStockInput => ({ productId: 1, code: "1", description: "Spot", supplierName: null, unit: "UN", stock: 4, unitCost: 10, lastSaleAt: null, firstStockAt: daysAgo(400), ...overrides });

describe("produtos parados", () => {
  it("conta da última venda ou, se nunca vendeu, da chegada ao estoque", () => {
    const result = staleStock([
      product({ productId: 1, lastSaleAt: daysAgo(120) }),
      product({ productId: 2, lastSaleAt: daysAgo(30) }),
      product({ productId: 3, firstStockAt: daysAgo(20) }),
      product({ productId: 4, firstStockAt: daysAgo(100), stock: 10, unitCost: 50 }),
      product({ productId: 5, stock: 0 }),
      product({ productId: 6, unitCost: null, lastSaleAt: daysAgo(95) }),
    ], 90, now);
    expect(result.rows.map((row) => row.productId)).toEqual([4, 1, 6]);
    expect(result.rows[1]).toMatchObject({ idleDays: 120, value: 40 });
    expect(result.totals).toEqual({ products: 3, value: 540, withoutCost: 1, neverSold: 1 });
  });
});

describe("curva ABC", () => {
  it("classifica pela participação acumulada e o que cruza o limite fica na classe de cima", () => {
    const { rows, summary, total } = abcCurve([
      { id: "a", revenue: 500 },
      { id: "b", revenue: 300 },
      { id: "c", revenue: 100 },
      { id: "d", revenue: 60 },
      { id: "e", revenue: 40 },
      { id: "zero", revenue: 0 },
    ]);
    expect(total).toBe(1000);
    expect(rows.map((row) => `${row.id}:${row.abc}`)).toEqual(["a:A", "b:A", "c:B", "d:B", "e:C"]);
    expect(rows[1]).toMatchObject({ share: 30, cumulative: 80 });
    expect(summary).toEqual([
      { abc: "A", products: 2, revenue: 800, share: 80 },
      { abc: "B", products: 2, revenue: 160, share: 16 },
      { abc: "C", products: 1, revenue: 40, share: 4 },
    ]);
  });

  it("um produto só é A", () => {
    expect(abcCurve([{ revenue: 10 }]).rows[0]!.abc).toBe("A");
  });
});
