import { CommercialStatus } from "./dashboardMetrics";

export type AlertableQuote = {
  id: number;
  quoteNumber: number;
  clientName: string;
  phone?: string | null;
  status: CommercialStatus;
  validUntil: Date | string | null;
  summary: { total: number };
};

export type ExpirationAlert = {
  id: number;
  quoteNumber: number;
  clientName: string;
  phone: string;
  validUntil: Date;
  total: number;
  daysRemaining: number;
  severity: "expired" | "today" | "soon" | "upcoming";
};

const DAY = 86_400_000;
const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
export type ExpirationQuickFilter = "all" | "today" | "expired";

export function getDaysRemaining(validUntil: Date | string, now = new Date()) {
  return Math.round((startOfDay(new Date(validUntil)) - startOfDay(now)) / DAY);
}

export function matchesExpirationQuickFilter(quote: Pick<AlertableQuote, "status" | "validUntil">, filter: ExpirationQuickFilter, now = new Date()) {
  if (filter === "all") return true;
  if ((quote.status !== "draft" && quote.status !== "open") || !quote.validUntil) return false;
  const daysRemaining = getDaysRemaining(quote.validUntil, now);
  return filter === "today" ? daysRemaining === 0 : daysRemaining < 0;
}

export function getExpirationAlerts(quotes: AlertableQuote[], now = new Date(), thresholdDays = 7) {
  const today = startOfDay(now);
  return quotes
    .filter((quote) => (quote.status === "draft" || quote.status === "open") && quote.validUntil)
    .map((quote) => {
      const validUntil = new Date(quote.validUntil!);
      const daysRemaining = Math.round((startOfDay(validUntil) - today) / DAY);
      const severity = daysRemaining < 0 ? "expired" : daysRemaining === 0 ? "today" : daysRemaining <= 3 ? "soon" : "upcoming";
      return { id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, phone: quote.phone ?? "", validUntil, total: quote.summary.total, daysRemaining, severity };
    })
    .filter((alert) => alert.daysRemaining <= thresholdDays)
    .sort((first, second) => first.daysRemaining - second.daysRemaining);
}
