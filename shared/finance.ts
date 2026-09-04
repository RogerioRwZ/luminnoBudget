export type FinanceStatus = "open" | "partial" | "paid" | "cancelled" | "overdue";
export type PaymentMethod = "pix" | "cash" | "credit_card" | "debit_card" | "bank_transfer" | "boleto" | "other";
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

export function calculateReceivableStatus(input: { originalAmount: number; receivedAmount: number; cancelled: boolean; dueDate: Date; now?: Date }): FinanceStatus {
  if (input.cancelled) return "cancelled";
  const remaining = roundMoney(input.originalAmount - input.receivedAmount);
  if (remaining <= 0) return "paid";
  if (input.receivedAmount > 0) return "partial";
  if (input.dueDate.getTime() < (input.now ?? new Date()).getTime()) return "overdue";
  return "open";
}

export function remainingReceivableAmount(originalAmount: number, receivedAmount: number) {
  return Math.max(0, roundMoney(originalAmount - receivedAmount));
}
