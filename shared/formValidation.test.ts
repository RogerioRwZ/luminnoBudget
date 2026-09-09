import { describe, expect, it } from "vitest";
import { formatLoginError, MAX_MONEY_VALUE, parseFiniteNumber, validateLoginCredentials, validateQuoteDraft, validateSettingsNumbers } from "./formValidation";

describe("form validation", () => {
  it("normaliza campos numéricos vazios e inválidos sem produzir NaN", () => {
    expect(parseFiniteNumber("", 7)).toBe(7);
    expect(parseFiniteNumber("abc", 7)).toBe(7);
    expect(parseFiniteNumber("12.50")).toBe(12.5);
  });

  it("rejeita orçamento com data, cliente ou números inválidos", () => {
    const base = { clientName: "Cliente", professional: "Profissional", issueDate: new Date("2026-08-25T12:00:00"), validUntil: null, discountValue: 0, shipping: 0, pixDiscountValue: 0, installments: 8, rooms: [{ name: "SALA", items: [{ shortDescription: "Item", quantity: 1, unitPrice: 10 }] }] };
    expect(validateQuoteDraft({ ...base, clientName: "" })).toContain("cliente");
    expect(validateQuoteDraft({ ...base, issueDate: new Date("invalid") })).toContain("emissão");
    expect(validateQuoteDraft({ ...base, rooms: [{ name: "SALA", items: [{ shortDescription: "Item", quantity: 0, unitPrice: 10 }] }] })).toContain("quantidade");
    expect(validateQuoteDraft(base)).toBeNull();
  });

  it("rejeita item sem descrição (ex.: item manual adicionado e nunca preenchido)", () => {
    const base = { clientName: "Cliente", professional: "Profissional", issueDate: new Date("2026-08-25T12:00:00"), validUntil: null, discountValue: 0, shipping: 0, pixDiscountValue: 0, installments: 8, rooms: [{ name: "SALA", items: [{ shortDescription: "   ", quantity: 1, unitPrice: 10 }] }] };
    expect(validateQuoteDraft(base)).toContain("descrição");
  });

  it("rejeita valores que estourariam a precisão decimal do banco (12,2)", () => {
    const base = { clientName: "Cliente", professional: "Profissional", issueDate: new Date("2026-08-25T12:00:00"), validUntil: null, discountValue: 0, shipping: 0, pixDiscountValue: 0, installments: 8, rooms: [{ name: "SALA", items: [{ shortDescription: "Item", quantity: 1, unitPrice: 10 }] }] };
    // Frete além do que a coluna decimal(12,2) comporta.
    expect(validateQuoteDraft({ ...base, shipping: MAX_MONEY_VALUE + 1 })).toContain("frete");
    // Um único item dentro do limite individualmente, mas cujo total
    // (quantidade × valor unitário) ultrapassa o limite.
    expect(
      validateQuoteDraft({
        ...base,
        rooms: [{ name: "SALA", items: [{ shortDescription: "Item", quantity: 1_000_000, unitPrice: 1_000_000 }] }],
      })
    ).toContain("quantidade");
    // No limite exato: deve ser aceito.
    expect(validateQuoteDraft({ ...base, shipping: MAX_MONEY_VALUE })).toBeNull();
  });

  it("exibe mensagem específica quando o login é limitado por tentativas", () => {
    expect(formatLoginError(new Error("Too many login attempts; try again later"))).toContain("Muitas tentativas");
    expect(formatLoginError(new Error("Usuário ou senha inválidos"))).toContain("credenciais");
  });

  it("valida credenciais do formulário antes do envio", () => {
    expect(validateLoginCredentials({ username: "a", password: "curta", setupRequired: false })).toContain("usuário");
    expect(validateLoginCredentials({ username: "ana.silva", password: "curta", setupRequired: false })).toContain("senha");
    expect(validateLoginCredentials({ username: "ana.silva", password: "senha-forte-com-12", setupRequired: true, name: "" })).toContain("nome");
    expect(validateLoginCredentials({ username: "ana.silva", password: "senha-forte-com-12", setupRequired: false })).toBeNull();
  });

  it("aceita um e-mail válido (incluindo quando contém a letra 's') ao configurar o administrador", () => {
    expect(validateLoginCredentials({ username: "ana.silva", password: "senha-forte-com-12", setupRequired: true, name: "Ana Silva", email: "ana.silva@empresa.com" })).toBeNull();
    expect(validateLoginCredentials({ username: "ana.silva", password: "senha-forte-com-12", setupRequired: true, name: "Ana Silva", email: "sem-arroba-empresa.com" })).toContain("e-mail");
  });

  it("aceita um e-mail válido (incluindo quando contém a letra 's') ao configurar o administrador", () => {
    expect(validateLoginCredentials({ username: "ana.silva", password: "senha-forte-com-12", setupRequired: true, name: "Ana Silva", email: "ana.silva@empresa.com" })).toBeNull();
    expect(validateLoginCredentials({ username: "ana.silva", password: "senha-forte-com-12", setupRequired: true, name: "Ana Silva", email: "sem-arroba-empresa.com" })).toContain("e-mail");
  });

  it("aplica limites de configurações", () => {
    expect(validateSettingsNumbers({ defaultPixDiscountValue: 0, defaultInstallments: 8, alertThresholdDays: 7 })).toBeNull();
    expect(validateSettingsNumbers({ defaultPixDiscountValue: 0, defaultInstallments: 0, alertThresholdDays: 7 })).toContain("parcelas");
    expect(validateSettingsNumbers({ defaultPixDiscountValue: 0, defaultInstallments: 8, alertThresholdDays: 61 })).toContain("alerta");
  });
});
