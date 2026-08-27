export type PickingSourceItem = { productId?: number | null; code: string; shortDescription: string; fullDescription?: string | null; unit: string; quantity: number; roomName: string };
export type PickingItem = { key: string; code: string; shortDescription: string; fullDescription: string; unit: string; quantity: number; rooms: string[] };

export function buildPickingList(items: PickingSourceItem[]): PickingItem[] {
  const grouped = new Map<string, PickingItem>();
  items.forEach((item) => {
    const key = item.productId ? `product-${item.productId}` : `manual-${item.code}-${item.shortDescription}`;
    const current = grouped.get(key) ?? { key, code: item.code, shortDescription: item.shortDescription, fullDescription: item.fullDescription?.trim() || item.shortDescription, unit: item.unit, quantity: 0, rooms: [] };
    current.quantity += item.quantity;
    if (!current.rooms.includes(item.roomName)) current.rooms.push(item.roomName);
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((first, second) => first.code.localeCompare(second.code, "pt-BR", { numeric: true }));
}
