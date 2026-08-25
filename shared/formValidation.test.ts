import { describe, expect, it } from "vitest";
import { parseFiniteNumber, validateQuoteDraft, validateSettingsNumbers } from "./formValidation";

describe("form validation", () => {
  it("normaliza campos numéricos vazios e inválidos sem produzir NaN", () => {
    expect(parseFiniteNumber("", 7)).toBe(7);
    expect(parseFiniteNumber("abc", 7)).toBe(7);
    expect(parseFiniteNumber("12.50")).toBe(12.5);
  });

  it("rejeita orçamento com data, cliente ou números inválidos", () => {
    const base = { clientName: "Cliente", professional: "Profissional", issueDate: new Date("2026-08-25T12:00:00"), validUntil: null, discountValue: 0, shipping: 0, pixDiscountValue: 0, installments: 8, rooms: [{ name: "SALA", items: [{ quantity: 1, unitPrice: 10 }] }] };
    expect(validateQuoteDraft({ ...base, clientName: "" })).toContain("cliente");
    expect(validateQuoteDraft({ ...base, issueDate: new Date("invalid") })).toContain("emissão");
    expect(validateQuoteDraft({ ...base, rooms: [{ name: "SALA", items: [{ quantity: 0, unitPrice: 10 }] }] })).toContain("quantidade");
  });

  it("aplica limites de configurações", () => {
    expect(validateSettingsNumbers({ defaultPixDiscountValue: 0, defaultInstallments: 8, alertThresholdDays: 7 })).toBeNull();
    expect(validateSettingsNumbers({ defaultPixDiscountValue: 0, defaultInstallments: 0, alertThresholdDays: 7 })).toContain("parcelas");
    expect(validateSettingsNumbers({ defaultPixDiscountValue: 0, defaultInstallments: 8, alertThresholdDays: 61 })).toContain("alerta");
  });
});
