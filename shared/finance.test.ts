import { describe, expect, it } from "vitest";
import { calculateReceivableStatus, dueDateForInstallment, remainingReceivableAmount, splitInstallments } from "./finance";

describe("regras financeiras", () => {
  it("divide valores em parcelas preservando os centavos no total", () => {
    const installments = splitInstallments(100, 3);
    expect(installments).toEqual([33.34, 33.33, 33.33]);
    expect(installments.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("calcula vencimentos mensais a partir da primeira parcela", () => {
    expect(dueDateForInstallment(new Date("2026-01-15T12:00:00Z"), 3).toISOString()).toBe("2026-03-15T12:00:00.000Z");
  });

  it("não pula fevereiro quando a primeira parcela vence no dia 31", () => {
    const firstDueDate = new Date("2026-01-31T12:00:00Z");
    // 2026 não é bissexto: fevereiro tem 28 dias.
    expect(dueDateForInstallment(firstDueDate, 2).toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(dueDateForInstallment(firstDueDate, 3).toISOString()).toBe("2026-03-31T12:00:00.000Z");
  });

  it("usa o dia 29 de fevereiro em ano bissexto ao invés de estourar para março", () => {
    const firstDueDate = new Date("2028-01-31T12:00:00Z");
    expect(dueDateForInstallment(firstDueDate, 2).toISOString()).toBe("2028-02-29T12:00:00.000Z");
  });

  it("distingue cobrança aberta, parcial, paga, vencida e cancelada", () => {
    const dueDate = new Date("2026-02-01T12:00:00Z");
    const now = new Date("2026-01-15T12:00:00Z");
    expect(calculateReceivableStatus({ originalAmount: 100, receivedAmount: 0, cancelled: false, dueDate, now })).toBe("open");
    expect(calculateReceivableStatus({ originalAmount: 100, receivedAmount: 25, cancelled: false, dueDate, now })).toBe("partial");
    expect(calculateReceivableStatus({ originalAmount: 100, receivedAmount: 100, cancelled: false, dueDate, now })).toBe("paid");
    expect(calculateReceivableStatus({ originalAmount: 100, receivedAmount: 0, cancelled: false, dueDate, now: new Date("2026-02-02T12:00:00Z") })).toBe("overdue");
    expect(calculateReceivableStatus({ originalAmount: 100, receivedAmount: 0, cancelled: true, dueDate, now })).toBe("cancelled");
  });

  it("não permite saldo negativo após recebimentos", () => {
    expect(remainingReceivableAmount(100, 130)).toBe(0);
  });
});
