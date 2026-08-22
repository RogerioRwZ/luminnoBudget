import { describe, expect, it } from "vitest";
import { calculateQuote } from "./quote";

describe("calculateQuote", () => {
  it("calcula subtotais, desconto, frete, PIX e parcelamento", () => {
    const summary = calculateQuote({
      rooms: [{ items: [{ quantity: 2, unitPrice: 100 }, { quantity: 3, unitPrice: 50 }] }, { items: [{ quantity: 1, unitPrice: 80 }] }],
      discountMode: "percentage",
      discountValue: 10,
      shipping: 20,
      pixDiscountMode: "fixed",
      pixDiscountValue: 15,
      installments: 5,
    });

    expect(summary.rooms).toEqual([350, 80]);
    expect(summary.productsSubtotal).toBe(430);
    expect(summary.discountAmount).toBe(43);
    expect(summary.total).toBe(407);
    expect(summary.pixTotal).toBe(392);
    expect(summary.installmentValue).toBe(81.4);
  });

  it("nunca permite desconto superior à base de cálculo", () => {
    const summary = calculateQuote({
      rooms: [{ items: [{ quantity: 1, unitPrice: 100 }] }],
      discountMode: "fixed",
      discountValue: 150,
      shipping: 0,
      pixDiscountMode: "percentage",
      pixDiscountValue: 50,
      installments: 1,
    });
    expect(summary.discountAmount).toBe(100);
    expect(summary.total).toBe(0);
    expect(summary.pixDiscountAmount).toBe(0);
  });
});
