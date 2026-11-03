// Forma de pagamento da venda, escolhida na aprovação do orçamento. Pode ter
// várias partes (entrada no PIX + parcelas no crediário, parte no PIX e parte
// no cartão...). Cartão, PIX, dinheiro e transferência entram como recebidos
// na hora; boleto e crediário próprio viram parcelas mensais no Financeiro.

import { roundMoney } from "./finance";

export const PLAN_METHODS = ["pix", "cash", "debit_card", "credit_card", "bank_transfer", "boleto", "store_credit"] as const;
export type PlanMethod = (typeof PLAN_METHODS)[number];
export const PLAN_METHOD_LABELS: Record<PlanMethod, string> = {
  pix: "PIX",
  cash: "Dinheiro",
  debit_card: "Cartão de débito",
  credit_card: "Cartão de crédito",
  bank_transfer: "Transferência",
  boleto: "Boleto",
  store_credit: "Crediário próprio",
};

// Boleto e crediário geram cobranças mensais; o resto é recebido na hora.
export const isBilledMethod = (method: PlanMethod) => method === "boleto" || method === "store_credit";
export const allowsInstallments = (method: PlanMethod) => method === "credit_card" || isBilledMethod(method);
export const isCardMethod = (method: PlanMethod) => method === "credit_card" || method === "debit_card";
export const MAX_PLAN_PARTS = 4;
export const MAX_PLAN_INSTALLMENTS = 24;

export type PaymentPlanPart = {
  method: PlanMethod;
  amount: number;
  installments: number;
  // Primeira parcela (aaaa-mm-dd), só para boleto e crediário.
  firstDueDate?: string | null;
};
export type PaymentPlan = { parts: PaymentPlanPart[] };

// À vista só em PIX/dinheiro vale o preço com desconto do PIX; qualquer
// outra combinação usa o total cheio.
export function planTarget(plan: PaymentPlan, totals: { total: number; pixTotal: number }) {
  const cashOnly = plan.parts.length > 0 && plan.parts.every((part) => part.method === "pix" || part.method === "cash");
  return roundMoney(cashOnly ? totals.pixTotal : totals.total);
}

export const planSum = (plan: PaymentPlan) => roundMoney(plan.parts.reduce((sum, part) => sum + part.amount, 0));

export function validatePaymentPlan(plan: PaymentPlan, totals: { total: number; pixTotal: number }): string | null {
  if (!plan.parts.length) return "Informe como o cliente vai pagar.";
  if (plan.parts.length > MAX_PLAN_PARTS) return `Use no máximo ${MAX_PLAN_PARTS} formas de pagamento.`;
  for (const part of plan.parts) {
    const label = PLAN_METHOD_LABELS[part.method];
    if (!(part.amount > 0)) return `Informe o valor pago em ${label}.`;
    if (Math.round(part.amount * 100) !== Math.round(roundMoney(part.amount) * 100)) return `Use no máximo 2 casas decimais em ${label}.`;
    if (!Number.isInteger(part.installments) || part.installments < 1 || part.installments > MAX_PLAN_INSTALLMENTS) return `Parcelas inválidas em ${label}.`;
    if (!allowsInstallments(part.method) && part.installments !== 1) return `${label} é à vista: use 1 parcela.`;
    if (isBilledMethod(part.method) && !/^\d{4}-\d{2}-\d{2}$/.test(part.firstDueDate ?? "")) return `Informe o vencimento da primeira parcela em ${label}.`;
  }
  const target = planTarget(plan, totals);
  const sum = planSum(plan);
  if (Math.abs(sum - target) > 0.009) {
    const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return `As formas de pagamento somam ${brl(sum)}, mas a venda é de ${brl(target)}.`;
  }
  return null;
}

export function parsePaymentPlan(text: string | null | undefined): PaymentPlan | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as PaymentPlan;
    return Array.isArray(value?.parts) ? value : null;
  } catch {
    return null;
  }
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// "R$ 300,00 no PIX + 5x de R$ 140,00 no crediário próprio".
export function describePart(part: PaymentPlanPart) {
  const label = PLAN_METHOD_LABELS[part.method];
  if (part.installments > 1) return `${part.installments}x de ${brl(part.amount / part.installments)} — ${label}`;
  return `${brl(part.amount)} — ${label}`;
}

export function describePlan(plan: PaymentPlan) {
  return plan.parts.map(describePart).join(" + ");
}

// Data local "aaaa-mm-dd" ao meio-dia (não vira o dia anterior em UTC).
export function dateFromInput(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

export function addDaysInput(days: number, from = new Date()) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Condição "entrada + crediário" oferecida na proposta: a entrada é um
// percentual do total e o restante vai em parcelas mensais.
export type EntryOffer = { entryPercent: number; installments: number };
export const DEFAULT_ENTRY_OFFER: EntryOffer = { entryPercent: 30, installments: 6 };

export function parseEntryOffer(text: string | null | undefined): EntryOffer | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<EntryOffer>;
    const entryPercent = Number(value.entryPercent);
    const installments = Math.floor(Number(value.installments));
    return entryPercent > 0 && entryPercent < 100 && installments >= 1 ? { entryPercent, installments } : null;
  } catch {
    return null;
  }
}

export function entryOfferValues(total: number, offer: EntryOffer) {
  const entry = roundMoney((total * offer.entryPercent) / 100);
  const remaining = roundMoney(total - entry);
  return { entry, remaining, installments: offer.installments, installmentValue: roundMoney(remaining / offer.installments) };
}

export function describeEntryOffer(total: number, offer: EntryOffer, label = "no crediário") {
  const values = entryOfferValues(total, offer);
  return `Entrada de ${brl(values.entry)} + ${values.installments}x de ${brl(values.installmentValue)} ${label}`;
}
