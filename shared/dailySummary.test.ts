import { describe, expect, it } from "vitest";
import { buildDailySummaryText, dailySummaryCount, type DailySummary } from "./dailySummary";

const empty: DailySummary = { date: new Date(2026, 10, 2), followUps: null, expiring: null, installments: null, purchases: null, deliveries: null, appointments: null };

describe("resumo do dia", () => {
  it("conta só as seções do perfil", () => {
    expect(dailySummaryCount(empty)).toBe(0);
    expect(dailySummaryCount({ ...empty, followUps: { count: 2, items: [] }, installments: { dueToday: { count: 1, amount: 10 }, overdue: { count: 3, amount: 30 }, items: [] } })).toBe(6);
  });

  it("monta o texto para o WhatsApp", () => {
    const text = buildDailySummaryText({
      ...empty,
      appointments: { count: 1, items: [{ id: 1, type: "installation", clientName: "Maria", scheduledAt: new Date(2026, 10, 2, 9, 30), responsible: "João", quoteNumber: 12 }] },
      followUps: { count: 1, items: [{ id: 2, quoteNumber: 40, clientName: "Pedro", total: 1500, late: true }] },
      installments: { dueToday: { count: 2, amount: 300 }, overdue: { count: 0, amount: 0 }, items: [] },
      purchases: { products: 3, quotesWaiting: 1, items: [] },
    }, "Luminno");
    expect(text).toContain("*Luminno — resumo de");
    expect(text).toContain("09:30 Instalação — Maria (João)");
    expect(text).toContain("#40 Pedro");
    expect(text).toContain("(atrasado)");
    expect(text).toContain("2 parcelas vencem hoje");
    expect(text).toContain("3 produtos aguardando compra para 1 pedido aprovado");
    expect(text).not.toContain("atrasadas");
  });

  it("avisa quando não há nada", () => {
    expect(buildDailySummaryText(empty, "Luminno")).toContain("Nada pendente para hoje");
  });
});
