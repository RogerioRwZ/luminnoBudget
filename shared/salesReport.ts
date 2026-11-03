import { roundMoney } from "./quote";

export type SalesReportQuote = {
  id: number;
  quoteNumber: number;
  approvedAt: Date;
  clientName: string;
  professional: string;
  sellerName: string;
  total: number;
  shipping: number;
  productsSubtotal: number;
  discountAmount: number;
  items: Array<{ productId: number | null; code: string; shortDescription: string; unit: string; quantity: number; unitPrice: number; unitCost: number | null }>;
};

export type SalesReportRow = {
  key: string;
  label: string;
  quotes: number;
  quantity: number;
  revenue: number;
  coveredRevenue: number;
  cost: number;
  profit: number;
  margin: number | null;
};

export type SalesReportLine = {
  quoteId: number;
  quoteNumber: number;
  approvedAt: Date;
  clientName: string;
  professional: string;
  sellerName: string;
  code: string;
  shortDescription: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  unitCost: number | null;
  cost: number | null;
};

type Accumulator = { label: string; quoteIds: Set<number>; quantity: number; revenue: number; coveredRevenue: number; cost: number };

function finish(map: Map<string, Accumulator>): SalesReportRow[] {
  return Array.from(map.entries())
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      quotes: entry.quoteIds.size,
      quantity: roundMoney(entry.quantity),
      revenue: roundMoney(entry.revenue),
      coveredRevenue: roundMoney(entry.coveredRevenue),
      cost: roundMoney(entry.cost),
      profit: roundMoney(entry.coveredRevenue - entry.cost),
      margin: entry.coveredRevenue > 0 ? (entry.coveredRevenue - entry.cost) / entry.coveredRevenue : null,
    }))
    .sort((first, second) => second.revenue - first.revenue || first.label.localeCompare(second.label, "pt-BR"));
}

// Vendas = orçamentos aprovados. O valor de cada item já desconta a sua parte
// do desconto do orçamento; o frete fica fora (não é venda de mercadoria).
export function buildSalesReport(quotes: SalesReportQuote[]) {
  const groups = { seller: new Map<string, Accumulator>(), professional: new Map<string, Accumulator>(), product: new Map<string, Accumulator>() };
  const lines: SalesReportLine[] = [];
  const add = (map: Map<string, Accumulator>, key: string, label: string, quoteId: number, quantity: number, revenue: number, cost: number | null) => {
    const entry = map.get(key) ?? { label, quoteIds: new Set<number>(), quantity: 0, revenue: 0, coveredRevenue: 0, cost: 0 };
    entry.quoteIds.add(quoteId);
    entry.quantity += quantity;
    entry.revenue += revenue;
    if (cost !== null) {
      entry.coveredRevenue += revenue;
      entry.cost += cost;
    }
    map.set(key, entry);
  };
  let total = 0;
  let shipping = 0;
  for (const quote of quotes) {
    total += quote.total;
    shipping += quote.shipping;
    const factor = quote.productsSubtotal > 0 ? Math.max(0, quote.productsSubtotal - quote.discountAmount) / quote.productsSubtotal : 0;
    const seller = quote.sellerName || "Não identificado";
    const professional = quote.professional.trim() || "Sem profissional";
    if (!quote.items.length) {
      add(groups.seller, seller, seller, quote.id, 0, 0, null);
      add(groups.professional, professional.toLocaleLowerCase("pt-BR"), professional, quote.id, 0, 0, null);
    }
    for (const item of quote.items) {
      const revenue = item.quantity * item.unitPrice * factor;
      const cost = item.unitCost === null ? null : item.quantity * item.unitCost;
      const productKey = item.productId ? `product-${item.productId}` : `manual-${item.code}-${item.shortDescription}`.toLocaleLowerCase("pt-BR");
      add(groups.seller, seller, seller, quote.id, item.quantity, revenue, cost);
      add(groups.professional, professional.toLocaleLowerCase("pt-BR"), professional, quote.id, item.quantity, revenue, cost);
      add(groups.product, productKey, item.code ? `${item.shortDescription} (#${item.code})` : item.shortDescription, quote.id, item.quantity, revenue, cost);
      lines.push({ quoteId: quote.id, quoteNumber: quote.quoteNumber, approvedAt: quote.approvedAt, clientName: quote.clientName, professional: quote.professional, sellerName: seller, code: item.code, shortDescription: item.shortDescription, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, revenue: roundMoney(revenue), unitCost: item.unitCost, cost: cost === null ? null : roundMoney(cost) });
    }
  }
  const bySeller = finish(groups.seller);
  const revenue = roundMoney(bySeller.reduce((sum, row) => sum + row.revenue, 0));
  const coveredRevenue = bySeller.reduce((sum, row) => sum + row.coveredRevenue, 0);
  const cost = roundMoney(bySeller.reduce((sum, row) => sum + row.cost, 0));
  return {
    totals: {
      quotes: quotes.length,
      total: roundMoney(total),
      shipping: roundMoney(shipping),
      revenue,
      cost,
      profit: roundMoney(coveredRevenue - cost),
      margin: coveredRevenue > 0 ? (coveredRevenue - cost) / coveredRevenue : null,
      averageTicket: quotes.length ? roundMoney(total / quotes.length) : 0,
      linesWithoutCost: lines.filter((line) => line.cost === null && line.revenue > 0).length,
    },
    bySeller,
    byProfessional: finish(groups.professional),
    byProduct: finish(groups.product),
    lines,
  };
}

export type SalesReport = ReturnType<typeof buildSalesReport>;

// Remove custo e margem (perfil sem acesso ao custo).
export function withoutCost(report: SalesReport): SalesReport {
  const strip = (row: SalesReportRow): SalesReportRow => ({ ...row, coveredRevenue: 0, cost: 0, profit: 0, margin: null });
  return {
    totals: { ...report.totals, cost: 0, profit: 0, margin: null, linesWithoutCost: 0 },
    bySeller: report.bySeller.map(strip),
    byProfessional: report.byProfessional.map(strip),
    byProduct: report.byProduct.map(strip),
    lines: report.lines.map((line) => ({ ...line, unitCost: null, cost: null })),
  };
}
