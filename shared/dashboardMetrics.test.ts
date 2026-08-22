import { describe, expect, it } from "vitest";
import { aggregateDashboardStatuses } from "./dashboardMetrics";

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
