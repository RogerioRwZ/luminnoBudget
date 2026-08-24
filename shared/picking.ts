export type PickingItem = { code: string; shortDescription: string; fullDescription: string | null; unit: string; quantity: number };

export function buildPickingList(items: PickingItem[]) {
  const grouped = new Map<string, PickingItem & { quantity: number }>();
  
  for (const item of items) {
    const key = `${item.code}|${item.unit}`;
    const existing = grouped.get(key);
    
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      grouped.set(key, { ...item, quantity: item.quantity });
    }
  }
  
  return Array.from(grouped.values()).sort((a, b) => a.code.localeCompare(b.code));
}
