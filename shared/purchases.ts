export type PurchaseLineInput = { code: string; shortDescription: string; unit: string; freeQuantity: number; reorderPoint: number; shortageQuantity: number; openDemandQuantity: number };

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

// Quanto pedir: a falta dos aprovados mais o necessário para o estoque livre
// voltar ao ponto de pedido (somando, se marcado, o que está em negociação).
export function purchaseQuantity(line: PurchaseLineInput, includeOpenQuotes: boolean) {
  const target = line.reorderPoint + (includeOpenQuotes ? line.openDemandQuantity : 0);
  return round(line.shortageQuantity + Math.max(0, target - line.freeQuantity));
}

export function buildPurchaseOrderText(input: { supplierName: string; storeName?: string | null; date: Date; lines: Array<PurchaseLineInput & { quantity: number }> }) {
  const items = input.lines.filter((line) => line.quantity > 0).map((line) => `• ${quantity(line.quantity)} ${line.unit} — ${line.shortDescription}${line.code ? ` (cód. ${line.code})` : ""}`);
  return [`Pedido de compra${input.storeName ? ` — ${input.storeName}` : ""}`, `Fornecedor: ${input.supplierName || "não informado"}`, `Data: ${new Intl.DateTimeFormat("pt-BR").format(input.date)}`, "", ...items, "", "Por favor, confirme disponibilidade, valores e prazo de entrega."].join("\n");
}
