// Pós-venda: trocas, devoluções e garantias dos itens vendidos.

export const AFTER_SALES_TYPES = ["return", "exchange", "warranty"] as const;
export type AfterSalesType = (typeof AFTER_SALES_TYPES)[number];
export const AFTER_SALES_TYPE_LABELS: Record<AfterSalesType, string> = {
  return: "Devolução",
  exchange: "Troca",
  warranty: "Garantia",
};

export const AFTER_SALES_REASONS = ["defect", "damaged", "wrong_product", "regret", "installation", "other"] as const;
export type AfterSalesReason = (typeof AFTER_SALES_REASONS)[number];
export const AFTER_SALES_REASON_LABELS: Record<AfterSalesReason, string> = {
  defect: "Defeito",
  damaged: "Avaria no transporte",
  wrong_product: "Produto errado",
  regret: "Desistência do cliente",
  installation: "Problema na instalação",
  other: "Outro",
};

export const AFTER_SALES_STATUSES = ["open", "supplier", "resolved", "rejected"] as const;
export type AfterSalesStatus = (typeof AFTER_SALES_STATUSES)[number];
export const AFTER_SALES_STATUS_LABELS: Record<AfterSalesStatus, string> = {
  open: "Em aberto",
  supplier: "Com o fornecedor",
  resolved: "Resolvido",
  rejected: "Recusado",
};

// Em andamento: ainda conta no prazo e ocupa a quantidade do item.
export const isActiveCase = (status: AfterSalesStatus) => status === "open" || status === "supplier";

export function isCaseOverdue(item: { status: AfterSalesStatus; dueDate: Date | string }, now = new Date()) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return isActiveCase(item.status) && new Date(item.dueDate) < startOfDay;
}

// Garantia contada da entrega (ou da aprovação, se ainda não houve retirada).
// Soma meses pelo calendário e, em meses mais curtos, para no último dia.
export function warrantyUntil(start: Date | string | null | undefined, months: number | null | undefined) {
  if (!start || !months || months <= 0) return null;
  const base = new Date(start);
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1, base.getHours(), base.getMinutes());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(base.getDate(), lastDay));
  return target;
}

// Cada retirada tem o próprio prazo: peças retiradas meses depois não herdam a
// garantia da primeira retirada.
export function warrantyLots(deliveries: Array<{ quantity: number; deliveredAt: Date }>, months: number | null | undefined, now = new Date()) {
  const lots = [...deliveries]
    .sort((first, second) => first.deliveredAt.getTime() - second.deliveredAt.getTime())
    .map((delivery) => {
      const until = warrantyUntil(delivery.deliveredAt, months);
      return { ...delivery, warrantyUntil: until, underWarranty: isUnderWarranty(until, now) };
    });
  return {
    lots,
    delivered: Math.round(lots.reduce((sum, lot) => sum + lot.quantity, 0) * 100) / 100,
    underWarrantyQuantity: Math.round(lots.filter((lot) => lot.underWarranty).reduce((sum, lot) => sum + lot.quantity, 0) * 100) / 100,
  };
}

export function isUnderWarranty(until: Date | null, now = new Date()) {
  return Boolean(until) && until! >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export type AfterSalesReportCase = {
  productId: number | null;
  productDescription: string;
  supplierName: string | null;
  type: AfterSalesType;
  reason: AfterSalesReason;
  status: AfterSalesStatus;
  quantity: number;
  openedAt: Date;
  resolvedAt: Date | null;
  dueDate: Date;
};

const round = (value: number) => Math.round(value * 100) / 100;
const DAY = 24 * 60 * 60_000;

// soldByProduct: unidades vendidas (orçamentos aprovados) por produto, para a
// taxa de problema. Itens avulsos agrupam pela descrição e ficam sem taxa.
export function buildAfterSalesReport(cases: AfterSalesReportCase[], soldByProduct: Map<number, number>, now = new Date()) {
  const group = <K extends string>(key: (item: AfterSalesReportCase) => K) => {
    const map = new Map<K, { cases: number; quantity: number }>();
    for (const item of cases) {
      const entry = map.get(key(item)) ?? { cases: 0, quantity: 0 };
      entry.cases += 1;
      entry.quantity = round(entry.quantity + item.quantity);
      map.set(key(item), entry);
    }
    return Array.from(map.entries()).map(([value, totals]) => ({ key: value, ...totals })).sort((first, second) => second.cases - first.cases || second.quantity - first.quantity);
  };

  const products = new Map<string, { productId: number | null; description: string; supplierName: string | null; cases: number; quantity: number }>();
  for (const item of cases) {
    const key = item.productId ? `p${item.productId}` : `d${item.productDescription.toLocaleLowerCase("pt-BR")}`;
    const entry = products.get(key) ?? { productId: item.productId, description: item.productDescription, supplierName: item.supplierName, cases: 0, quantity: 0 };
    entry.cases += 1;
    entry.quantity = round(entry.quantity + item.quantity);
    products.set(key, entry);
  }
  const byProduct = Array.from(products.values())
    .map((entry) => {
      const sold = entry.productId ? soldByProduct.get(entry.productId) ?? 0 : 0;
      return { ...entry, sold, rate: sold > 0 ? round((entry.quantity / sold) * 100) : null };
    })
    .sort((first, second) => second.cases - first.cases || second.quantity - first.quantity);

  const finished = cases.filter((item) => item.status === "resolved" && item.resolvedAt);
  const averageDays = finished.length ? round(finished.reduce((sum, item) => sum + (item.resolvedAt!.getTime() - item.openedAt.getTime()) / DAY, 0) / finished.length) : null;

  return {
    totals: {
      cases: cases.length,
      quantity: round(cases.reduce((sum, item) => sum + item.quantity, 0)),
      active: cases.filter((item) => isActiveCase(item.status)).length,
      overdue: cases.filter((item) => isCaseOverdue(item, now)).length,
      resolved: cases.filter((item) => item.status === "resolved").length,
      rejected: cases.filter((item) => item.status === "rejected").length,
      averageResolutionDays: averageDays,
    },
    byProduct,
    byReason: group((item) => item.reason),
    byType: group((item) => item.type),
    bySupplier: group((item) => item.supplierName?.trim() || "Sem fornecedor"),
  };
}
