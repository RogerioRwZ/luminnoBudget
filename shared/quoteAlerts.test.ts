import { describe, expect, it } from "vitest";
import { getExpirationAlerts, matchesExpirationQuickFilter } from "./quoteAlerts";

describe("getExpirationAlerts", () => {
  const now = new Date("2026-08-21T12:00:00");
  it("destaca propostas pendentes vencidas, para hoje e próximas", () => {
    const alerts = getExpirationAlerts([
      { id: 1, quoteNumber: 101, clientName: "Vencido", status: "open", validUntil: "2026-08-20T12:00:00", summary: { total: 100 } },
      { id: 2, quoteNumber: 102, clientName: "Hoje", status: "draft", validUntil: "2026-08-21T12:00:00", summary: { total: 200 } },
      { id: 3, quoteNumber: 103, clientName: "Próximo", status: "open", validUntil: "2026-08-24T12:00:00", summary: { total: 300 } },
      { id: 4, quoteNumber: 104, clientName: "Distante", status: "open", validUntil: "2026-08-30T12:00:00", summary: { total: 400 } },
      { id: 5, quoteNumber: 105, clientName: "Aprovado", status: "approved", validUntil: "2026-08-22T12:00:00", summary: { total: 500 } },
    ], now);
    expect(alerts.map((alert) => [alert.quoteNumber, alert.daysRemaining, alert.severity])).toEqual([[101, -1, "expired"], [102, 0, "today"], [103, 3, "soon"]]);
  });

  it("filtra somente pendentes que vencem hoje ou já venceram", () => {
    expect(matchesExpirationQuickFilter({ status: "open", validUntil: "2026-08-21T12:00:00" }, "today", now)).toBe(true);
    expect(matchesExpirationQuickFilter({ status: "draft", validUntil: "2026-08-20T12:00:00" }, "expired", now)).toBe(true);
    expect(matchesExpirationQuickFilter({ status: "approved", validUntil: "2026-08-20T12:00:00" }, "expired", now)).toBe(false);
  });
});
