export type FinanceStatus = "open" | "partial" | "paid" | "cancelled" | "overdue";
export type PaymentMethod = "pix" | "cash" | "credit_card" | "debit_card" | "bank_transfer" | "boleto" | "store_credit" | "other";
export type PaymentType = "receipt" | "reversal";

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function splitInstallments(total: number, installmentCount: number) {
  const count = Math.max(1, Math.floor(installmentCount));
  const cents = Math.round(roundMoney(total) * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

export function dueDateForInstallment(firstDueDate: Date, installmentNumber: number) {
  const monthsToAdd = Math.max(0, installmentNumber - 1);
  const dueDate = new Date(firstDueDate);
  const targetMonthIndex = dueDate.getMonth() + monthsToAdd;
  // Quando o dia da primeira parcela não existe no mês de destino (ex.: dia
  // 31 e o mês seguinte tem 28/29/30 dias), o JS "estoura" para o mês
  // seguinte (31/jan + 1 mês vira 3/mar em vez de 28/fev). Por isso
  // calculamos quantos dias o mês de destino tem e limitamos o dia ANTES de
  // trocar de mês, evitando esse estouro.
  const daysInTargetMonth = new Date(dueDate.getFullYear(), targetMonthIndex + 1, 0).getDate();
  dueDate.setDate(Math.min(dueDate.getDate(), daysInTargetMonth));
  dueDate.setMonth(targetMonthIndex);
  return dueDate;
}

// Dia no fuso da loja ("2026-11-04"), para comparar datas: a parcela vence no
// fim do dia, e não na hora gravada, seja qual for o fuso do servidor.
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
export const businessDay = (date: Date) => DAY_FORMAT.format(date);

export function calculateReceivableStatus(input: { originalAmount: number; receivedAmount: number; cancelled: boolean; dueDate: Date; now?: Date }): FinanceStatus {
  if (input.cancelled) return "cancelled";
  const remaining = roundMoney(input.originalAmount - input.receivedAmount);
  if (remaining <= 0) return "paid";
  // Vencimento vem antes de "parcial": uma parcela paga em parte e já
  // vencida continua em atraso (e entra no total "Em atraso").
  if (businessDay(input.dueDate) < businessDay(input.now ?? new Date())) return "overdue";
  if (input.receivedAmount > 0) return "partial";
  return "open";
}

export function remainingReceivableAmount(originalAmount: number, receivedAmount: number) {
  return Math.max(0, roundMoney(originalAmount - receivedAmount));
}
