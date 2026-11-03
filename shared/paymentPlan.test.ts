import { describe, expect, it } from "vitest";
import { describeEntryOffer, describePlan, entryOfferValues, parseEntryOffer, parsePaymentPlan, planTarget, validatePaymentPlan, type PaymentPlan } from "./paymentPlan";

const totals = { total: 1000, pixTotal: 900 };

describe("forma de pagamento", () => {
  it("só PIX/dinheiro usa o preço do PIX; qualquer outra combinação, o total", () => {
    expect(planTarget({ parts: [{ method: "pix", amount: 900, installments: 1 }] }, totals)).toBe(900);
    expect(planTarget({ parts: [{ method: "pix", amount: 500, installments: 1 }, { method: "cash", amount: 400, installments: 1 }] }, totals)).toBe(900);
    expect(planTarget({ parts: [{ method: "pix", amount: 300, installments: 1 }, { method: "store_credit", amount: 700, installments: 3 }] }, totals)).toBe(1000);
  });

  it("valida soma, parcelas e vencimento", () => {
    const ok: PaymentPlan = { parts: [{ method: "pix", amount: 300, installments: 1 }, { method: "store_credit", amount: 700, installments: 3, firstDueDate: "2026-12-05" }] };
    expect(validatePaymentPlan(ok, totals)).toBeNull();
    expect(validatePaymentPlan({ parts: [] }, totals)).toMatch(/como o cliente/);
    expect(validatePaymentPlan({ parts: [{ method: "pix", amount: 900, installments: 2 }] }, totals)).toMatch(/à vista/);
    expect(validatePaymentPlan({ parts: [{ method: "boleto", amount: 1000, installments: 2 }] }, totals)).toMatch(/vencimento/);
    expect(validatePaymentPlan({ parts: [{ method: "credit_card", amount: 999.99, installments: 3 }] }, totals)).toMatch(/somam/);
    expect(validatePaymentPlan({ parts: [{ method: "credit_card", amount: 1000, installments: 25 }] }, totals)).toMatch(/Parcelas inválidas/);
  });

  it("descreve e lê a forma gravada", () => {
    expect(describePlan({ parts: [{ method: "pix", amount: 300, installments: 1 }, { method: "store_credit", amount: 700, installments: 2 }] })).toMatch(/^R\$\s?300,00 — PIX \+ 2x de R\$\s?350,00 — Crediário próprio$/);
    expect(parsePaymentPlan("lixo")).toBeNull();
    expect(parsePaymentPlan(null)).toBeNull();
  });

  it("calcula e descreve a condição de entrada + crediário", () => {
    expect(entryOfferValues(415.31, { entryPercent: 30, installments: 3 })).toEqual({ entry: 124.59, remaining: 290.72, installments: 3, installmentValue: 96.91 });
    expect(describeEntryOffer(1000, { entryPercent: 20, installments: 4 })).toMatch(/^Entrada de R\$\s?200,00 \+ 4x de R\$\s?200,00 no crediário$/);
    expect(parseEntryOffer(JSON.stringify({ entryPercent: 30, installments: 6 }))).toEqual({ entryPercent: 30, installments: 6 });
    expect(parseEntryOffer(JSON.stringify({ entryPercent: 0, installments: 6 }))).toBeNull();
    expect(parseEntryOffer(null)).toBeNull();
  });
});
