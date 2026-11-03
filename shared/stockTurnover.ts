// Giro de estoque: produtos parados e curva ABC das vendas.

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const DAY = 24 * 60 * 60_000;

export type StaleStockInput = {
  productId: number;
  code: string;
  description: string;
  supplierName: string | null;
  unit: string;
  stock: number;
  unitCost: number | null;
  lastSaleAt: Date | null;
  // Primeira entrada no estoque (ou cadastro): um produto recém-chegado que
  // ainda não vendeu não está "parado".
  firstStockAt: Date;
};

// Parado: tem saldo e não vende há `days` dias (contando da última venda ou,
// se nunca vendeu, da chegada ao estoque).
export function staleStock(products: StaleStockInput[], days: number, now = new Date()) {
  const rows = products
    .filter((product) => product.stock > 0)
    .map((product) => {
      const idleSince = product.lastSaleAt ?? product.firstStockAt;
      const idleDays = Math.max(0, Math.floor((now.getTime() - idleSince.getTime()) / DAY));
      return { ...product, idleSince, idleDays, value: product.unitCost === null ? null : round(product.stock * product.unitCost) };
    })
    .filter((row) => row.idleDays >= days)
    .sort((first, second) => (second.value ?? -1) - (first.value ?? -1) || second.idleDays - first.idleDays);
  return {
    rows,
    totals: {
      products: rows.length,
      value: round(rows.reduce((sum, row) => sum + (row.value ?? 0), 0)),
      withoutCost: rows.filter((row) => row.value === null).length,
      neverSold: rows.filter((row) => !row.lastSaleAt).length,
    },
  };
}

export type AbcClass = "A" | "B" | "C";
export const ABC_LIMITS = { A: 0.8, B: 0.95 } as const;
export const ABC_DESCRIPTIONS: Record<AbcClass, string> = {
  A: "Os poucos produtos que fazem 80% do faturamento: nunca podem faltar.",
  B: "Os próximos 15% do faturamento: reposição regular.",
  C: "Os 5% finais, normalmente muitos produtos: compre sob demanda.",
};

// Ordena pelo faturamento e classifica pela participação acumulada: o produto
// que cruza 80% ainda é A (e o que cruza 95%, ainda é B).
export function abcCurve<T extends { revenue: number }>(rows: T[]) {
  const sorted = rows.filter((row) => row.revenue > 0).sort((first, second) => second.revenue - first.revenue);
  const total = sorted.reduce((sum, row) => sum + row.revenue, 0);
  let before = 0;
  const classified = sorted.map((row) => {
    const share = total > 0 ? row.revenue / total : 0;
    const abc: AbcClass = before < ABC_LIMITS.A ? "A" : before < ABC_LIMITS.B ? "B" : "C";
    before += share;
    return { ...row, share: round(share * 100), cumulative: round(Math.min(before, 1) * 100), abc };
  });
  const summary = (["A", "B", "C"] as const).map((abc) => {
    const members = classified.filter((row) => row.abc === abc);
    const revenue = round(members.reduce((sum, row) => sum + row.revenue, 0));
    return { abc, products: members.length, revenue, share: total > 0 ? round((revenue / total) * 100) : 0 };
  });
  return { rows: classified, summary, total: round(total) };
}
