export type DraftRoom<TItem> = {
  name: string;
  items: TItem[];
};

export function moveArrayItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function duplicateArrayItem<T>(items: T[], index: number, copy: T): T[] {
  if (index < 0 || index >= items.length) return items;
  return [...items.slice(0, index + 1), copy, ...items.slice(index + 1)];
}

export function removeArrayItem<T>(items: T[], index: number): T[] {
  if (index < 0 || index >= items.length) return items;
  return items.filter((_, current) => current !== index);
}

export function moveDraftRoom<TItem>(rooms: DraftRoom<TItem>[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= rooms.length) return rooms;
  const cloned = rooms.map((room) => ({ ...room, items: [...room.items] }));
  return moveArrayItem(cloned, index, direction);
}

export function duplicateDraftRoom<TItem>(rooms: DraftRoom<TItem>[], index: number) {
  const source = rooms[index];
  if (!source) return rooms;
  const copy: DraftRoom<TItem> = {
    name: `${source.name} (CÓPIA)`,
    items: source.items.map((item) => ({ ...item })),
  };
  return duplicateArrayItem(rooms, index, copy);
}

export function removeDraftRoom<TItem>(rooms: DraftRoom<TItem>[], index: number) {
  if (rooms.length <= 1) return rooms;
  return removeArrayItem(rooms, index);
}

export function moveDraftItem<TItem>(items: TItem[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}
