import { roundMoney } from "./quote";

export type MarginItem = { quantity: number; unitPrice: number; unitCost: number | null | undefined };

// Margem sobre a mercadoria, depois do desconto e sem o frete. Itens sem
// custo cadastrado ficam fora da conta (e são contados à parte), para um
// item avulso não inflar a margem como se tivesse custo zero.
export function quoteMargin(items: MarginItem[], discountAmount: number) {
  const gross = items.reduce((sum, item) => sum + Math.max(0, item.quantity) * Math.max(0, item.unitPrice), 0);
  const factor = gross > 0 ? Math.max(0, gross - discountAmount) / gross : 0;
  let coveredRevenue = 0;
  let cost = 0;
  let missingCost = 0;
  for (const item of items) {
    const revenue = Math.max(0, item.quantity) * Math.max(0, item.unitPrice) * factor;
    if (item.unitCost === null || item.unitCost === undefined) {
      if (revenue > 0) missingCost += 1;
      continue;
    }
    coveredRevenue += revenue;
    cost += Math.max(0, item.quantity) * Math.max(0, item.unitCost);
  }
  return {
    revenue: roundMoney(gross * factor),
    coveredRevenue: roundMoney(coveredRevenue),
    cost: roundMoney(cost),
    profit: roundMoney(coveredRevenue - cost),
    margin: coveredRevenue > 0 ? (coveredRevenue - cost) / coveredRevenue : null,
    missingCost,
  };
}

export function discountPercent(productsSubtotal: number, discountAmount: number) {
  return productsSubtotal > 0 ? (discountAmount / productsSubtotal) * 100 : 0;
}

export const percentLabel = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
