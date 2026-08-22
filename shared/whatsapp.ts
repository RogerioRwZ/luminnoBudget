import { PricingSummary } from "./quote";

export type WhatsAppRoom = { name: string; items: Array<{ quantity: number; shortDescription: string; unitPrice: number }> };
const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function buildWhatsAppProposal(input: { brand: string; quoteNumber: number; clientName: string; rooms: WhatsAppRoom[]; installments: number; notes?: string; summary: PricingSummary }) {
  const roomLines = input.rooms.flatMap((room, roomIndex) => [`🏠 *${room.name}*`, ...room.items.map((item) => `• ${item.quantity}x ${item.shortDescription} — ${currency(item.quantity * item.unitPrice)}`), `Subtotal: ${currency(input.summary.rooms[roomIndex] ?? 0)}`, ""]);
  return [`✨ *${input.brand} Iluminação*`, `🧾 *ORÇAMENTO #${input.quoteNumber}*`, `👤 Cliente: ${input.clientName || "Não informado"}`, "", ...roomLines, `💡 *Total: ${currency(input.summary.total)}*`, `💳 Em até ${input.installments}x de ${currency(input.summary.installmentValue)} sem juros`, input.summary.pixDiscountAmount > 0 ? `⚡ PIX: ${currency(input.summary.pixTotal)} (${currency(input.summary.pixDiscountAmount)} de desconto)` : "", input.notes ? `\n${input.notes}` : ""].filter(Boolean).join("\n");
}

export function buildExpirationReminder(input: { brand: string; quoteNumber: number; clientName: string; validUntil: Date | string; daysRemaining: number; total: number }) {
  const validity = new Intl.DateTimeFormat("pt-BR").format(new Date(input.validUntil));
  const deadline = input.daysRemaining < 0 ? `está vencida há ${Math.abs(input.daysRemaining)} dia(s)` : input.daysRemaining === 0 ? "vence hoje" : `vence em ${input.daysRemaining} dia(s)`;
  return [`✨ *${input.brand}*`, `Olá, ${input.clientName || "tudo bem"}!`, "", `🧾 Sobre o orçamento *#${input.quoteNumber}*: a proposta ${deadline}.`, `📅 Validade: ${validity}`, `💡 Valor da proposta: ${currency(input.total)}`, "", "Se precisar de algum ajuste ou quiser seguir com o pedido, estamos à disposição."].join("\n");
}

export function normalizeWhatsAppPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}
