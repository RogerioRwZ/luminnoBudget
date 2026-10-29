import { describe, expect, it } from "vitest";
import { aggregateDashboardStatuses, aggregateMonthlyPerformance, conversionRate } from "./dashboardMetrics";

describe("aggregateDashboardStatuses", () => {
  it("agrupa rascunhos e abertos como pendentes e soma valores por status", () => {
    const summaries = aggregateDashboardStatuses([
      { status: "draft", summary: { total: 120 } },
      { status: "open", summary: { total: 80 } },
      { status: "approved", summary: { total: 300 } },
      { status: "lost", summary: { total: 45 } },
    ]);
    expect(summaries).toEqual([
      { key: "approved", label: "Aprovados", count: 1, value: 300 },
      { key: "pending", label: "Pendentes", count: 2, value: 200 },
      { key: "rejected", label: "Rejeitados", count: 1, value: 45 },
    ]);
  });
});

describe("evolução mensal", () => {
  it("agrupa orçamentos e recebimentos nos últimos meses", () => {
    const now = new Date(2026, 9, 15);
    const months = aggregateMonthlyPerformance(
      [
        { status: "approved", summary: { total: 1000 }, issueDate: new Date(2026, 9, 2) },
        { status: "lost", summary: { total: 500 }, issueDate: new Date(2026, 9, 3) },
        { status: "open", summary: { total: 300 }, issueDate: new Date(2026, 8, 20) },
        { status: "approved", summary: { total: 999 }, issueDate: new Date(2025, 0, 1) },
      ],
      [
        { type: "receipt", amount: 400, paidAt: new Date(2026, 9, 10) },
        { type: "reversal", amount: 100, paidAt: new Date(2026, 9, 11) },
      ],
      now,
      3,
    );
    expect(months.map((month) => month.label)).toEqual(["ago/26", "set/26", "out/26"]);
    expect(months[2]).toMatchObject({ quoted: 1000, approved: 1000, received: 300, quotes: 2, approvedCount: 1, lostCount: 1 });
    expect(months[1]).toMatchObject({ quoted: 300, approved: 0, quotes: 1 });
    expect(conversionRate([{ status: "approved" }, { status: "lost" }, { status: "lost" }, { status: "open" }])).toBeCloseTo(1 / 3);
    expect(conversionRate([{ status: "draft" }])).toBeNull();
  });
});
