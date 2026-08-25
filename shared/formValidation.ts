export function parseFiniteNumber(value: string, fallback = 0) {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isFiniteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export type QuoteValidationInput = {
  clientName: string;
  professional: string;
  issueDate: Date;
  validUntil: Date | null;
  discountValue: number;
  shipping: number;
  pixDiscountValue: number;
  installments: number;
  rooms: Array<{ name: string; items: Array<{ quantity: number; unitPrice: number }> }>;
};

export function validateQuoteDraft(input: QuoteValidationInput): string | null {
  if (!input.clientName.trim()) return "Informe o nome do cliente.";
  if (!input.professional.trim()) return "Informe o profissional responsável.";
  if (Number.isNaN(input.issueDate.getTime())) return "Informe uma data de emissão válida.";
  if (input.validUntil && Number.isNaN(input.validUntil.getTime())) return "Informe uma validade válida.";
  if (!isFiniteNonNegative(input.discountValue)) return "Informe um desconto válido.";
  if (!isFiniteNonNegative(input.shipping)) return "Informe um frete válido.";
  if (!isFiniteNonNegative(input.pixDiscountValue)) return "Informe um desconto PIX válido.";
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 24) return "Escolha entre 1 e 24 parcelas.";
  if (!input.rooms.length || input.rooms.some((room) => !room.name.trim())) return "Todos os ambientes precisam de um nome.";
  if (input.rooms.some((room) => room.items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || !isFiniteNonNegative(item.unitPrice)))) return "Revise quantidade e valor dos itens.";
  return null;
}

export function validateSettingsNumbers(input: { defaultPixDiscountValue: number; defaultInstallments: number; alertThresholdDays: number }) {
  if (!isFiniteNonNegative(input.defaultPixDiscountValue)) return "Informe um desconto PIX válido.";
  if (!Number.isInteger(input.defaultInstallments) || input.defaultInstallments < 1 || input.defaultInstallments > 24) return "As parcelas devem estar entre 1 e 24.";
  if (!Number.isInteger(input.alertThresholdDays) || input.alertThresholdDays < 1 || input.alertThresholdDays > 60) return "O alerta deve estar entre 1 e 60 dias.";
  return null;
}
