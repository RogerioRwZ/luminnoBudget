export type MessageEvent =
  | "quote_sent"
  | "quote_approved"
  | "quote_expiring"
  | "quote_expired"
  | "payment_due"
  | "payment_overdue"
  | "delivery_scheduled"
  | "delivery_completed";

export const MESSAGE_EVENT_LABELS: Record<MessageEvent, string> = {
  quote_sent: "Orçamento enviado",
  quote_approved: "Orçamento aprovado",
  quote_expiring: "Orçamento vencendo",
  quote_expired: "Orçamento vencido",
  payment_due: "Parcela a vencer",
  payment_overdue: "Parcela vencida",
  delivery_scheduled: "Entrega agendada",
  delivery_completed: "Entrega concluída",
};

export const MESSAGE_VARIABLES = ["cliente", "numero", "valor", "validade", "vencimento", "parcela", "dias", "loja", "telefone_loja", "chave_pix", "total_pix", "pix"] as const;
export type MessageVariable = (typeof MESSAGE_VARIABLES)[number];
export type MessageVariables = Partial<Record<MessageVariable, string | number | null | undefined>>;

// Texto usado quando não há modelo ativo cadastrado para o evento.
export const DEFAULT_MESSAGE_TEMPLATES: Record<MessageEvent, { subject: string; body: string }> = {
  quote_sent: {
    subject: "Orçamento #{{numero}} — {{loja}}",
    body: "Olá, {{cliente}}! Segue o orçamento #{{numero}} da {{loja}}, no valor de {{valor}}.\nValidade: {{validade}}.\nÀ vista no PIX: {{total_pix}}\nPIX copia e cola: {{pix}}\n\nQualquer dúvida, estamos à disposição.",
  },
  quote_approved: {
    subject: "Orçamento #{{numero}} aprovado — {{loja}}",
    body: "Olá, {{cliente}}! Obrigado pela confiança: o orçamento #{{numero}} ({{valor}}) foi aprovado.\nEm breve entraremos em contato para combinar a entrega.",
  },
  quote_expiring: {
    subject: "Seu orçamento #{{numero}} vence em breve",
    body: "Olá, {{cliente}}! O orçamento #{{numero}}, no valor de {{valor}}, {{dias}} (validade {{validade}}).\nSe quiser seguir com o pedido ou ajustar algo, é só responder esta mensagem.",
  },
  quote_expired: {
    subject: "Seu orçamento #{{numero}} venceu",
    body: "Olá, {{cliente}}! O orçamento #{{numero}} ({{valor}}) {{dias}}.\nPodemos revisar os valores e enviar uma proposta atualizada?",
  },
  payment_due: {
    subject: "Lembrete: parcela {{parcela}} vence em {{vencimento}}",
    body: "Olá, {{cliente}}! Lembrete da parcela {{parcela}} do orçamento #{{numero}}, no valor de {{valor}}, com vencimento em {{vencimento}}.\nPIX copia e cola: {{pix}}\n\nSe já pagou, desconsidere esta mensagem.",
  },
  payment_overdue: {
    subject: "Parcela {{parcela}} em atraso",
    body: "Olá, {{cliente}}! A parcela {{parcela}} do orçamento #{{numero}}, no valor de {{valor}}, venceu em {{vencimento}}.\nPIX copia e cola: {{pix}}\n\nSe já pagou, por favor nos envie o comprovante.",
  },
  delivery_scheduled: {
    subject: "Entrega do orçamento #{{numero}}",
    body: "Olá, {{cliente}}! A entrega do orçamento #{{numero}} está agendada. Qualquer dúvida, fale com a {{loja}} pelo {{telefone_loja}}.",
  },
  delivery_completed: {
    subject: "Entrega concluída — orçamento #{{numero}}",
    body: "Olá, {{cliente}}! A entrega do orçamento #{{numero}} foi concluída. Obrigado por comprar com a {{loja}}!",
  },
};

const VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gi;

// Preenche as variáveis {{nome}}. Uma linha que dependa de uma variável sem
// valor (ex.: "PIX copia e cola: {{pix}}" sem chave cadastrada) é omitida
// inteira, para a mensagem não ficar com rótulos vazios. Variáveis
// desconhecidas ficam como estão, para a pessoa perceber o erro no modelo.
export function renderMessage(template: string, variables: MessageVariables) {
  const known = new Set<string>(MESSAGE_VARIABLES);
  const lines = template.split(/\r?\n/);
  const rendered: string[] = [];
  for (const line of lines) {
    let missing = false;
    const output = line.replace(VARIABLE_PATTERN, (match, rawName: string) => {
      const name = rawName.toLowerCase();
      if (!known.has(name)) return match;
      const value = variables[name as MessageVariable];
      if (value === null || value === undefined || String(value).trim() === "") {
        missing = true;
        return "";
      }
      return String(value);
    });
    if (!missing) rendered.push(output);
  }
  return rendered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function daysPhrase(daysRemaining: number) {
  if (daysRemaining < 0) return `venceu há ${Math.abs(daysRemaining)} dia(s)`;
  if (daysRemaining === 0) return "vence hoje";
  return `vence em ${daysRemaining} dia(s)`;
}

export function whatsappLink(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
