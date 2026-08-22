export type QuoteStatus = "draft" | "open" | "approved" | "lost";
export type QuoteStatusFilter = "all" | "pending" | "approved" | "lost";

export function matchesQuoteStatusFilter(status: QuoteStatus, filter: QuoteStatusFilter) {
  if (filter === "all") return true;
  if (filter === "pending") return status === "draft" || status === "open";
  return status === filter;
}
