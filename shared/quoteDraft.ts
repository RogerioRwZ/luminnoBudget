export type DraftRoom<TItem> = {
  name: string;
  items: TItem[];
};

export function moveDraftRoom<TItem>(rooms: DraftRoom<TItem>[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= rooms.length) return rooms;
  const next = rooms.map((room) => ({ ...room, items: [...room.items] }));
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function duplicateDraftRoom<TItem>(rooms: DraftRoom<TItem>[], index: number) {
  const source = rooms[index];
  if (!source) return rooms;
  const copy: DraftRoom<TItem> = {
    name: `${source.name} (CÓPIA)`,
    items: source.items.map((item) => ({ ...item })),
  };
  return [...rooms.slice(0, index + 1), copy, ...rooms.slice(index + 1)];
}

export function removeDraftRoom<TItem>(rooms: DraftRoom<TItem>[], index: number) {
  if (rooms.length <= 1 || index < 0 || index >= rooms.length) return rooms;
  return rooms.filter((_, roomIndex) => roomIndex !== index);
}

export function moveDraftItem<TItem>(items: TItem[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}
