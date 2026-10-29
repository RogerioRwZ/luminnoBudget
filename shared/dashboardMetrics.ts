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

export type MonthlyQuoteLike = DashboardQuoteLike & { issueDate: Date | string };
export type MonthlyPaymentLike = { type: "receipt" | "reversal"; amount: number; paidAt: Date | string };

export type MonthlyPerformance = {
  key: string;
  label: string;
  quoted: number;
  approved: number;
  received: number;
  quotes: number;
  approvedCount: number;
  lostCount: number;
};

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

// Evolução dos últimos `months` meses (incluindo o atual), pela data de
// emissão do orçamento e pela data de cada recebimento/estorno.
export function aggregateMonthlyPerformance(quotes: MonthlyQuoteLike[], payments: MonthlyPaymentLike[], now = new Date(), months = 6): MonthlyPerformance[] {
  const buckets = new Map<string, MonthlyPerformance>();
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = monthKey(date);
    buckets.set(key, { key, label: `${MONTH_LABELS[date.getMonth()]}/${String(date.getFullYear()).slice(2)}`, quoted: 0, approved: 0, received: 0, quotes: 0, approvedCount: 0, lostCount: 0 });
  }
  quotes.forEach((quote) => {
    const bucket = buckets.get(monthKey(new Date(quote.issueDate)));
    if (!bucket) return;
    bucket.quotes += 1;
    if (quote.status !== "lost") bucket.quoted += quote.summary.total;
    if (quote.status === "approved") {
      bucket.approved += quote.summary.total;
      bucket.approvedCount += 1;
    }
    if (quote.status === "lost") bucket.lostCount += 1;
  });
  payments.forEach((payment) => {
    const bucket = buckets.get(monthKey(new Date(payment.paidAt)));
    if (!bucket) return;
    bucket.received += payment.type === "receipt" ? payment.amount : -payment.amount;
  });
  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    quoted: Math.round(bucket.quoted * 100) / 100,
    approved: Math.round(bucket.approved * 100) / 100,
    received: Math.round(bucket.received * 100) / 100,
  }));
}

// Taxa de conversão sobre propostas já decididas (aprovadas ou perdidas);
// rascunhos e propostas em aberto não entram na conta. null = sem base.
export function conversionRate(quotes: Array<{ status: CommercialStatus }>) {
  const approved = quotes.filter((quote) => quote.status === "approved").length;
  const decided = approved + quotes.filter((quote) => quote.status === "lost").length;
  return decided ? approved / decided : null;
}
