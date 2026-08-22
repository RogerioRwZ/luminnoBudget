export type CommercialStatus = "draft" | "open" | "approved" | "lost";

export type DashboardQuoteLike = {
  status: CommercialStatus;
  summary: { total: number };
};

export type StatusSummary = {
  key: "approved" | "pending" | "rejected";
  label: string;
  count: number;
  value: number;
};

export function aggregateDashboardStatuses(quotes: DashboardQuoteLike[]) {
  const groups: Record<StatusSummary["key"], StatusSummary> = {
    approved: { key: "approved", label: "Aprovados", count: 0, value: 0 },
    pending: { key: "pending", label: "Pendentes", count: 0, value: 0 },
    rejected: { key: "rejected", label: "Rejeitados", count: 0, value: 0 },
  };
  quotes.forEach((quote) => {
    const key = quote.status === "approved" ? "approved" : quote.status === "lost" ? "rejected" : "pending";
    groups[key].count += 1;
    groups[key].value += quote.summary.total;
  });
  return [groups.approved, groups.pending, groups.rejected];
}
