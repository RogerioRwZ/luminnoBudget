export function parseFiniteNumber(value: string, fallback = 0) {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isFiniteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

// As colunas de dinheiro no banco são decimal(precisão: 12, escala: 2) —
// no máximo 9.999.999.999,99. Um valor além disso (ou uma multiplicação
// quantidade × valor unitário que ultrapasse esse limite) não cabe na
// coluna: sem essa validação no cliente, o salvamento falharia com um
// erro cru de banco de dados em vez de uma mensagem compreensível.
export const MAX_MONEY_VALUE = 9_999_999_999.99;

export function isValidMoneyAmount(value: number) {
  return isFiniteNonNegative(value) && value <= MAX_MONEY_VALUE;
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
  rooms: Array<{ name: string; items: Array<{ shortDescription: string; quantity: number; unitPrice: number }> }>;
};

export function validateQuoteDraft(input: QuoteValidationInput): string | null {
  if (!input.clientName.trim()) return "Informe o nome do cliente.";
  if (!input.professional.trim()) return "Informe o profissional responsável.";
  if (Number.isNaN(input.issueDate.getTime())) return "Informe uma data de emissão válida.";
  if (input.validUntil && Number.isNaN(input.validUntil.getTime())) return "Informe uma validade válida.";
  if (!isValidMoneyAmount(input.discountValue)) return "Informe um desconto válido.";
  if (!isValidMoneyAmount(input.shipping)) return "Informe um frete válido.";
  if (!isValidMoneyAmount(input.pixDiscountValue)) return "Informe um desconto PIX válido.";
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 24) return "Escolha entre 1 e 24 parcelas.";
  if (!input.rooms.length || input.rooms.some((room) => !room.name.trim())) return "Todos os ambientes precisam de um nome.";
  if (input.rooms.some((room) => room.items.some((item) => !item.shortDescription.trim()))) return "Todo item precisa de uma descrição.";
  if (
    input.rooms.some((room) =>
      room.items.some(
        (item) =>
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          item.quantity > MAX_MONEY_VALUE ||
          !isValidMoneyAmount(item.unitPrice) ||
          item.quantity * item.unitPrice > MAX_MONEY_VALUE
      )
    )
  )
    return "Revise quantidade e valor dos itens.";
  return null;
}

export function formatLoginError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/rate.?limit|login attempts|muitas tentativas|tente novamente|429/i.test(message)) return "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.";
  return "Não foi possível entrar. Verifique suas credenciais e tente novamente.";
}

export function validateLoginCredentials(input: { username: string; password: string; setupRequired: boolean; name?: string; email?: string }) {
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(input.username.trim().toLowerCase())) return "Informe um usuário válido (3 a 80 caracteres).";
  if (input.password.length < 12 || input.password.length > 200) return "A senha deve ter entre 12 e 200 caracteres.";
  if (input.setupRequired && (!input.name || input.name.trim().length < 2)) return "Informe o nome completo do administrador.";
  if (input.setupRequired && input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return "Informe um e-mail válido.";
  return null;
}

export function validateSettingsNumbers(input: { defaultPixDiscountValue: number; defaultInstallments: number; alertThresholdDays: number }) {
  if (!isFiniteNonNegative(input.defaultPixDiscountValue)) return "Informe um desconto PIX válido.";
  if (!Number.isInteger(input.defaultInstallments) || input.defaultInstallments < 1 || input.defaultInstallments > 24) return "As parcelas devem estar entre 1 e 24.";
  if (!Number.isInteger(input.alertThresholdDays) || input.alertThresholdDays < 1 || input.alertThresholdDays > 60) return "O alerta deve estar entre 1 e 60 dias.";
  return null;
}
