import { describe, expect, it } from "vitest";
import { buildPurchaseOrderText, purchaseQuantity } from "./purchases";

const line = { code: "12", shortDescription: "Spot LED", unit: "UN", freeQuantity: 0, reorderPoint: 0, shortageQuantity: 0, openDemandQuantity: 0 };

describe("purchaseQuantity", () => {
  it("compra a falta dos aprovados", () => {
    expect(purchaseQuantity({ ...line, shortageQuantity: 4 }, false)).toBe(4);
  });
  it("repõe até o ponto de pedido, descontando o estoque livre", () => {
    expect(purchaseQuantity({ ...line, freeQuantity: 2, reorderPoint: 5 }, false)).toBe(3);
  });
  it("soma o que está em negociação só quando pedido", () => {
    const negotiating = { ...line, freeQuantity: 2, reorderPoint: 5, openDemandQuantity: 4 };
    expect(purchaseQuantity(negotiating, false)).toBe(3);
    expect(purchaseQuantity(negotiating, true)).toBe(7);
  });
});

describe("buildPurchaseOrderText", () => {
  it("lista só itens com quantidade", () => {
    const text = buildPurchaseOrderText({ supplierName: "Lumi", storeName: "Luminno", date: new Date(2026, 10, 2), lines: [{ ...line, quantity: 3.5 }, { ...line, shortDescription: "Fita", quantity: 0 }] });
    expect(text).toContain("Fornecedor: Lumi");
    expect(text).toContain("• 3,5 UN — Spot LED (cód. 12)");
    expect(text).not.toContain("Fita");
  });
});
