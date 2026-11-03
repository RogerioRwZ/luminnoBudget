import { describe, expect, it } from "vitest";
import { cardFeeAmount, describePlan, parseCardFees, parsePaymentPlan, planTarget, validatePaymentPlan, type PaymentPlan } from "./paymentPlan";

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

  it("calcula a taxa da maquininha por número de vezes", () => {
    const fees = parseCardFees(JSON.stringify({ debit: 1.2, credit: [3, 4, 5, 6, 6, 6, 7, 7, 7, 8, 8, 9] }));
    expect(cardFeeAmount(fees, "debit_card", 1, 500)).toBe(6);
    expect(cardFeeAmount(fees, "credit_card", 3, 1000)).toBe(50);
    expect(cardFeeAmount(fees, "credit_card", 18, 1000)).toBe(90);
    expect(cardFeeAmount(fees, "pix", 1, 1000)).toBe(0);
    expect(parseCardFees("{")).toEqual({ debit: 0, credit: Array(12).fill(0) });
  });
});
