// "Orçamento 0012 - Maria Silva - Arq. Paulo.pdf". O profissional só entra
// quando informado; caracteres proibidos em nomes de arquivo viram espaço.
export function quotePdfFileName(quote: { quoteNumber: number; clientName?: string | null; professional?: string | null }) {
  const parts = [`Orçamento ${String(quote.quoteNumber).padStart(4, "0")}`, quote.clientName, quote.professional]
    .map(part => (part ?? "").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return `${parts.join(" - ").slice(0, 170).trim()}.pdf`;
}

// Imagens dos dados de um PDF do histórico: só as guardadas no próprio
// sistema. Um endereço de fora faria o navegador de quem baixa o PDF acessar
// outro site; esses são descartados (o PDF sai sem a imagem).
export const isLocalImage = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/uploads/") && !value.includes("..") && !/[\s\\]/.test(value);

export function sanitizePdfSnapshot<T extends { rooms?: unknown; settings?: unknown }>(snapshot: T): T {
  const rooms = Array.isArray(snapshot.rooms)
    ? snapshot.rooms.map((room: { items?: unknown }) => ({
        ...room,
        items: Array.isArray(room?.items) ? room.items.map((item: { imageUrl?: unknown }) => ({ ...item, imageUrl: isLocalImage(item?.imageUrl) ? item.imageUrl : null })) : [],
      }))
    : [];
  const settings = snapshot.settings && typeof snapshot.settings === "object"
    ? { ...(snapshot.settings as Record<string, unknown>), logoUrl: isLocalImage((snapshot.settings as { logoUrl?: unknown }).logoUrl) ? (snapshot.settings as { logoUrl: string }).logoUrl : null }
    : snapshot.settings;
  return { ...snapshot, rooms, settings };
}
