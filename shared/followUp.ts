export const LOST_REASONS = ["price", "deadline", "competitor", "postponed", "product", "no_response", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: "Preço",
  deadline: "Prazo de entrega",
  competitor: "Comprou de concorrente",
  postponed: "Adiou ou desistiu da obra",
  product: "Produto não atendeu",
  no_response: "Cliente não respondeu",
  other: "Outro motivo",
};

export function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

// Retorno vence no dia marcado, qualquer que seja a hora.
export function isFollowUpDue(followUpAt: Date | string | null | undefined, now = new Date()) {
  if (!followUpAt) return false;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return new Date(followUpAt).getTime() < endOfToday.getTime();
}

const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function buildFollowUpMessage(input: { brand: string; quoteNumber: number; clientName: string; total: number }) {
  return [
    `✨ *${input.brand}*`,
    `Olá, ${input.clientName || "tudo bem"}!`,
    "",
    `Passando para saber se ficou alguma dúvida sobre o orçamento *#${input.quoteNumber}* (${currency(input.total)}).`,
    "Se quiser ajustar algum item, prazo ou forma de pagamento, é só me dizer.",
  ].join("\n");
}
