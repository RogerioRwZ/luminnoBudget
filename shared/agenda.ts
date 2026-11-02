export const APPOINTMENT_TYPE_LABELS = {
  delivery: "Entrega",
  technical_visit: "Visita técnica",
  installation: "Instalação",
} as const;
export const APPOINTMENT_STATUS_LABELS = {
  scheduled: "Agendado",
  done: "Concluído",
  cancelled: "Cancelado",
} as const;

// Semana de segunda a domingo que contém a data.
export function weekRange(reference: Date) {
  const from = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

export function buildAppointmentMessage(input: { brand: string; type: keyof typeof APPOINTMENT_TYPE_LABELS; clientName: string; scheduledAt: Date; address?: string | null; quoteNumber?: number | null }) {
  const when = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(input.scheduledAt);
  const what = APPOINTMENT_TYPE_LABELS[input.type].toLowerCase();
  return [
    `✨ *${input.brand}*`,
    `Olá, ${input.clientName || "tudo bem"}!`,
    "",
    `📅 Confirmando a ${what}${input.quoteNumber ? ` do orçamento #${input.quoteNumber}` : ""}: ${when}.`,
    input.address ? `📍 Endereço: ${input.address}` : "",
    "",
    "Se precisar mudar o horário, é só responder esta mensagem.",
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}
