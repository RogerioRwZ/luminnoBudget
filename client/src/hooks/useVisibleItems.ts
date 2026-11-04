import { useEffect, useState } from "react";

// Listas longas: desenhar milhares de linhas trava a tela. Mostra um pedaço e
// o botão "Mostrar mais"; a busca e a exportação continuam vendo tudo.
export function useVisibleItems<T>(items: T[], resetKey: unknown = null, pageSize = 50) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [resetKey, pageSize]);
  return { visible: items.slice(0, limit), remaining: Math.max(0, items.length - limit), showMore: () => setLimit(current => current + pageSize) };
}
