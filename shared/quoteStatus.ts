export type QuoteStatus = "draft" | "open" | "approved" | "lost";
export type QuoteStatusFilter = "all" | "pending" | "approved" | "lost";

export function matchesQuoteStatusFilter(status: QuoteStatus, filter: QuoteStatusFilter) {
  if (filter === "all") return true;
  if (filter === "pending") return status === "draft" || status === "open";
  return status === filter;
}

// Nomes únicos dos status em todo o sistema (telas, painel, PDF e registro).
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Rascunho",
  open: "Em aberto",
  approved: "Aprovado",
  lost: "Não aprovado",
};

export const QUOTE_STATUS_FILTER_LABELS: Record<QuoteStatusFilter, string> = {
  all: "Todos",
  pending: "Em negociação",
  approved: "Aprovados",
  lost: "Não aprovados",
};
