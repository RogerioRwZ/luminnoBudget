// `quantity` é o que ainda falta separar (pedido menos o já retirado).
export type PickingSourceItem = {
  quoteItemId?: number;
  productId?: number | null;
  barcode?: string | null;
  code: string;
  shortDescription: string;
  fullDescription?: string | null;
  unit: string;
  quantity: number;
  orderedQuantity?: number;
  deliveredQuantity?: number;
  deliverableQuantity?: number;
  roomName: string;
};
export type PickingLine = { quoteItemId: number; roomName: string; pending: number; deliverable: number };
export type PickingItem = {
  key: string;
  productId: number | null;
  barcode: string | null;
  code: string;
  shortDescription: string;
  fullDescription: string;
  unit: string;
  quantity: number;
  orderedQuantity: number;
  deliveredQuantity: number;
  deliverableQuantity: number;
  rooms: string[];
  lines: PickingLine[];
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildPickingList(items: PickingSourceItem[]): PickingItem[] {
  const grouped = new Map<string, PickingItem>();
  items.forEach((item) => {
    const key = item.productId ? `product-${item.productId}` : `manual-${item.code}-${item.shortDescription}`;
    const current = grouped.get(key) ?? { key, productId: item.productId ?? null, barcode: item.barcode || null, code: item.code, shortDescription: item.shortDescription, fullDescription: item.fullDescription?.trim() || item.shortDescription, unit: item.unit, quantity: 0, orderedQuantity: 0, deliveredQuantity: 0, deliverableQuantity: 0, rooms: [], lines: [] };
    current.quantity = round(current.quantity + item.quantity);
    current.orderedQuantity = round(current.orderedQuantity + (item.orderedQuantity ?? item.quantity));
    current.deliveredQuantity = round(current.deliveredQuantity + (item.deliveredQuantity ?? 0));
    current.deliverableQuantity = round(current.deliverableQuantity + (item.deliverableQuantity ?? 0));
    if (!current.rooms.includes(item.roomName)) current.rooms.push(item.roomName);
    if (item.quoteItemId) current.lines.push({ quoteItemId: item.quoteItemId, roomName: item.roomName, pending: item.quantity, deliverable: item.deliverableQuantity ?? 0 });
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((first, second) => first.code.localeCompare(second.code, "pt-BR", { numeric: true }));
}

// Reparte a quantidade conferida de um produto entre os itens do orçamento
// (um por ambiente), respeitando o que cada um pode retirar agora.
export function distributePicked(item: Pick<PickingItem, "lines">, picked: number) {
  let remaining = round(picked);
  const result: Array<{ quoteItemId: number; quantity: number }> = [];
  for (const line of item.lines) {
    if (remaining <= 0) break;
    const quantity = round(Math.min(remaining, line.deliverable));
    if (quantity <= 0) continue;
    result.push({ quoteItemId: line.quoteItemId, quantity });
    remaining = round(remaining - quantity);
  }
  return { lines: result, leftover: remaining };
}

// "12 UN · 5,5 M": somar unidades diferentes num número só não faz sentido.
export function totalsByUnit(items: Array<{ unit: string; quantity: number }>) {
  const totals = new Map<string, number>();
  items.forEach((item) => totals.set(item.unit, round((totals.get(item.unit) ?? 0) + item.quantity)));
  const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  return Array.from(totals.entries()).map(([unit, quantity]) => `${format.format(quantity)} ${unit}`).join(" · ");
}
