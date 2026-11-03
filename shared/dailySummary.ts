import { APPOINTMENT_TYPE_LABELS } from "./agenda";

type AppointmentType = keyof typeof APPOINTMENT_TYPE_LABELS;
import { plural } from "./plural";
import { AFTER_SALES_TYPE_LABELS, type AfterSalesType } from "./afterSales";
import type { BackupState } from "./backupStatus";

// Cada seção é null quando o perfil não tem acesso à área correspondente.
export type DailySummary = {
  date: Date;
  followUps: { count: number; items: Array<{ id: number; quoteNumber: number; clientName: string; total: number; late: boolean }> } | null;
  expiring: { count: number; items: Array<{ id: number; quoteNumber: number; clientName: string; total: number }> } | null;
  installments: {
    dueToday: { count: number; amount: number };
    overdue: { count: number; amount: number };
    items: Array<{ id: number; clientName: string; quoteNumber: number | null; installmentNumber: number; installmentCount: number; remainingAmount: number; dueDate: Date; overdue: boolean }>;
  } | null;
  purchases: { products: number; quotesWaiting: number; items: Array<{ productId: number; shortDescription: string; unit: string; quantity: number; supplierName: string | null }> } | null;
  deliveries: { count: number; items: Array<{ quoteId: number; quoteNumber: number; clientName: string; lines: number }> } | null;
  appointments: { count: number; items: Array<{ id: number; type: AppointmentType; clientName: string; scheduledAt: Date; responsible: string | null; quoteNumber: number | null }> } | null;
  loans: { count: number; items: Array<{ id: number; borrowerName: string; pending: number; dueDate: Date; overdue: boolean }> } | null;
  afterSales: { count: number; items: Array<{ id: number; quoteNumber: number | null; clientName: string; productDescription: string; type: AfterSalesType; overdue: boolean }> } | null;
  // Só para administradores e só quando o backup atrasou ou falhou.
  backup: { state: BackupState; lastSuccessAt: Date | null; error: string | null } | null;
};

export function dailySummaryCount(summary: DailySummary | null | undefined) {
  if (!summary) return 0;
  return (summary.followUps?.count ?? 0)
    + (summary.expiring?.count ?? 0)
    + (summary.installments ? summary.installments.dueToday.count + summary.installments.overdue.count : 0)
    + (summary.purchases?.products ?? 0)
    + (summary.deliveries?.count ?? 0)
    + (summary.appointments?.count ?? 0)
    + (summary.afterSales?.count ?? 0)
    + (summary.loans?.count ?? 0)
    + (summary.backup ? 1 : 0);
}

const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const time = (value: Date | string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));

// Texto para colar no WhatsApp ou num grupo da equipe.
export function buildDailySummaryText(summary: DailySummary, brand: string) {
  const day = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(summary.date));
  const lines = [`☀️ *${brand} — resumo de ${day}*`];
  const section = (title: string, rows: string[]) => {
    if (rows.length) lines.push("", `*${title}*`, ...rows.map((row) => `• ${row}`));
  };
  if (summary.appointments) section(`Agenda (${summary.appointments.count})`, summary.appointments.items.map((item) => `${time(item.scheduledAt)} ${APPOINTMENT_TYPE_LABELS[item.type]} — ${item.clientName}${item.responsible ? ` (${item.responsible})` : ""}`));
  if (summary.followUps) section(`Retornos de propostas (${summary.followUps.count})`, summary.followUps.items.map((item) => `#${item.quoteNumber} ${item.clientName || "sem cliente"} — ${currency(item.total)}${item.late ? " (atrasado)" : ""}`));
  if (summary.expiring) section(`Propostas vencendo hoje (${summary.expiring.count})`, summary.expiring.items.map((item) => `#${item.quoteNumber} ${item.clientName || "sem cliente"} — ${currency(item.total)}`));
  if (summary.installments) {
    const rows: string[] = [];
    if (summary.installments.dueToday.count) rows.push(`${plural(summary.installments.dueToday.count, "parcela vence", "parcelas vencem")} hoje: ${currency(summary.installments.dueToday.amount)}`);
    if (summary.installments.overdue.count) rows.push(`${plural(summary.installments.overdue.count, "parcela atrasada", "parcelas atrasadas")}: ${currency(summary.installments.overdue.amount)}`);
    section("Financeiro", rows);
  }
  if (summary.deliveries) section(`Pedidos prontos para retirada (${summary.deliveries.count})`, summary.deliveries.items.map((item) => `#${item.quoteNumber} ${item.clientName}`));
  if (summary.purchases && summary.purchases.products) section("Compras", [`${plural(summary.purchases.products, "produto aguardando", "produtos aguardando")} compra para ${plural(summary.purchases.quotesWaiting, "pedido aprovado", "pedidos aprovados")}`]);
  if (summary.backup) section("Sistema", [summary.backup.state === "failed" ? "O último backup falhou" : `Backup atrasado${summary.backup.lastSuccessAt ? ` (último em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(summary.backup.lastSuccessAt))})` : ""}`]);
  if (summary.loans) section(`Mostruário para devolver (${summary.loans.count})`, summary.loans.items.map((item) => `Empréstimo #${item.id} — ${item.borrowerName}: ${item.pending} peça(s)${item.overdue ? " (atrasado)" : ""}`));
  if (summary.afterSales) section(`Pós-venda (${summary.afterSales.count})`, summary.afterSales.items.map((item) => `${AFTER_SALES_TYPE_LABELS[item.type]} #${item.id} — ${item.clientName}: ${item.productDescription}${item.overdue ? " (atrasado)" : ""}`));
  if (lines.length === 1) lines.push("", "Nada pendente para hoje. ✅");
  return lines.join("\n");
}

// Uma linha para o aviso no celular: "1 compromisso · 2 parcelas · …".
export function dailySummaryHeadline(summary: DailySummary) {
  const parts: string[] = [];
  const add = (count: number | undefined, one: string, many: string) => {
    if (count) parts.push(plural(count, one, many));
  };
  add(summary.appointments?.count, "compromisso", "compromissos");
  add(summary.followUps?.count, "retorno de proposta", "retornos de propostas");
  add(summary.expiring?.count, "proposta vencendo", "propostas vencendo");
  add(summary.installments ? summary.installments.dueToday.count + summary.installments.overdue.count : 0, "parcela a receber", "parcelas a receber");
  add(summary.deliveries?.count, "pedido pronto para retirada", "pedidos prontos para retirada");
  add(summary.purchases?.products, "produto para comprar", "produtos para comprar");
  add(summary.loans?.count, "empréstimo para devolver", "empréstimos para devolver");
  add(summary.afterSales?.count, "pós-venda com prazo", "pós-vendas com prazo");
  if (summary.backup) parts.push(summary.backup.state === "failed" ? "backup falhou" : "backup atrasado");
  return parts.join(" · ");
}
