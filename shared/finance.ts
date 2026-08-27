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
  const dueDate = new Date(firstDueDate);
  dueDate.setMonth(dueDate.getMonth() + Math.max(0, installmentNumber - 1));
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
