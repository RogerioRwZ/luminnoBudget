// Mostruário e consignação: peças emprestadas para o cliente ou o
// profissional testar na obra.

export const BORROWER_KINDS = ["client", "professional", "other"] as const;
export type BorrowerKind = (typeof BORROWER_KINDS)[number];
export const BORROWER_KIND_LABELS: Record<BorrowerKind, string> = {
  client: "Cliente",
  professional: "Profissional",
  other: "Outro",
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export type LoanItemQuantities = { quantity: number; returnedQuantity: number; soldQuantity: number; lostQuantity: number };

// Ainda com o cliente: emprestado menos o que voltou, virou venda ou se perdeu.
export const loanItemPending = (item: LoanItemQuantities) => round(Math.max(0, item.quantity - item.returnedQuantity - item.soldQuantity - item.lostQuantity));

export function loanStatus(items: LoanItemQuantities[], dueDate: Date | string, now = new Date()) {
  const pending = round(items.reduce((sum, item) => sum + loanItemPending(item), 0));
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { pending, open: pending > 0, overdue: pending > 0 && new Date(dueDate) < startOfDay };
}

// Acerto de um item: o que volta, o que virou venda e o que se perdeu não
// pode passar do que ainda está com o cliente.
export function validateSettlement(item: LoanItemQuantities, settle: { returned: number; sold: number; lost: number }) {
  const values = [settle.returned, settle.sold, settle.lost];
  if (values.some((value) => value < 0 || !Number.isFinite(value))) return "Informe quantidades positivas.";
  const total = round(values.reduce((sum, value) => sum + value, 0));
  const pending = loanItemPending(item);
  if (total > pending) return `Só ${pending} ainda estão emprestados neste item.`;
  return null;
}
