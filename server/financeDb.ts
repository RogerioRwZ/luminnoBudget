import { desc, eq, inArray, sql } from "drizzle-orm";
import { clients, financePayments, financeReceivables, quotes } from "../drizzle/schema";
import { calculateReceivableStatus, dueDateForInstallment, PaymentMethod, PaymentType, remainingReceivableAmount, roundMoney, splitInstallments } from "../shared/finance";
import { toNumber } from "../shared/quote";
import { getDb } from "./db";

const money = (value: number) => roundMoney(value).toFixed(2);

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

type ReceivableRow = typeof financeReceivables.$inferSelect;
type PaymentRow = typeof financePayments.$inferSelect;

function hydrateReceivable(receivable: ReceivableRow, payments: PaymentRow[], now = new Date()) {
  const receipts = payments.filter((payment) => payment.type === "receipt").reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const reversals = payments.filter((payment) => payment.type === "reversal").reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const receivedAmount = roundMoney(receipts - reversals);
  const originalAmount = toNumber(receivable.originalAmount);
  const status = calculateReceivableStatus({ originalAmount, receivedAmount, cancelled: receivable.status === "cancelled", dueDate: receivable.dueDate, now });
  return {
    ...receivable,
    originalAmount,
    receivedAmount,
    remainingAmount: remainingReceivableAmount(originalAmount, receivedAmount),
    status,
    overdue: status === "overdue",
    payments: payments.map((payment) => ({ ...payment, amount: toNumber(payment.amount) })),
  };
}

export async function financeOverview() {
  const db = await database();
  const [receivables, payments, quoteRows] = await Promise.all([
    db.select().from(financeReceivables).orderBy(financeReceivables.dueDate, desc(financeReceivables.id)),
    db.select().from(financePayments).orderBy(desc(financePayments.paidAt), desc(financePayments.id)).limit(200),
    db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber }).from(quotes),
  ]);
  const paymentsByReceivable = new Map<number, PaymentRow[]>();
  payments.forEach((payment) => {
    const existing = paymentsByReceivable.get(payment.receivableId) ?? [];
    existing.push(payment);
    paymentsByReceivable.set(payment.receivableId, existing);
  });
  const quoteNumbers = new Map(quoteRows.map((quote) => [quote.id, quote.quoteNumber]));
  const rows = receivables.map((receivable) => ({ ...hydrateReceivable(receivable, paymentsByReceivable.get(receivable.id) ?? []), quoteNumber: receivable.quoteId ? quoteNumbers.get(receivable.quoteId) ?? null : null }));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const receivedThisMonth = payments.filter((payment) => payment.type === "receipt" && payment.paidAt >= monthStart).reduce((sum, payment) => sum + toNumber(payment.amount), 0)
    - payments.filter((payment) => payment.type === "reversal" && payment.paidAt >= monthStart).reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const activeRows = rows.filter((row) => row.status !== "cancelled");
  const overdueRows = rows.filter((row) => row.overdue);
  return {
    receivables: rows,
    totals: {
      expected: activeRows.reduce((sum, row) => sum + row.originalAmount, 0),
      received: activeRows.reduce((sum, row) => sum + row.receivedAmount, 0),
      outstanding: activeRows.reduce((sum, row) => sum + row.remainingAmount, 0),
      overdueAmount: overdueRows.reduce((sum, row) => sum + row.remainingAmount, 0),
      overdueCount: overdueRows.length,
      receivedThisMonth: roundMoney(receivedThisMonth),
    },
  };
}

export async function createReceivables(input: { quoteId?: number | null; clientId?: number | null; clientName: string; description: string; totalAmount: number; installmentCount: number; firstDueDate: Date }, createdByUserId: number) {
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw new Error("O valor da cobrança deve ser maior que zero.");
  const installmentCount = Math.max(1, Math.min(24, Math.floor(input.installmentCount)));
  const installments = splitInstallments(input.totalAmount, installmentCount);
  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = [] as number[];
    for (let index = 0; index < installments.length; index += 1) {
      const result = await tx.insert(financeReceivables).values({
        quoteId: input.quoteId || null,
        clientId: input.clientId || null,
        clientName: input.clientName.trim() || "Cliente não informado",
        description: input.description.trim() || "Cobrança avulsa",
        installmentNumber: index + 1,
        installmentCount,
        originalAmount: money(installments[index]!),
        dueDate: dueDateForInstallment(input.firstDueDate, index + 1),
        status: "open",
        createdByUserId,
      }).$returningId();
      inserted.push(result[0]!.id);
    }
    return inserted;
  });
}

export async function createReceivablesFromQuote(input: { id: number; quoteNumber: number; clientId: number | null; clientName: string; installments: number; issueDate: Date; summary: { total: number } }, createdByUserId: number) {
  const db = await database();
  const existing = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(eq(financeReceivables.quoteId, input.id)).limit(1);
  if (existing.length) return { created: false, ids: [] as number[] };
  const ids = await createReceivables({ quoteId: input.id, clientId: input.clientId, clientName: input.clientName, description: `Orçamento #${input.quoteNumber}`, totalAmount: input.summary.total, installmentCount: input.installments, firstDueDate: input.issueDate }, createdByUserId);
  return { created: true, ids };
}

export async function recordFinancePayment(input: { receivableId: number; type: PaymentType; amount: number; paymentMethod: PaymentMethod; paidAt: Date; reference?: string | null; notes?: string | null }, createdByUserId: number) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("O valor informado deve ser maior que zero.");
  const db = await database();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${financeReceivables} WHERE ${eq(financeReceivables.id, input.receivableId)} FOR UPDATE`);
    const receivable = (await tx.select().from(financeReceivables).where(eq(financeReceivables.id, input.receivableId)).limit(1))[0];
    if (!receivable) throw new Error("Cobrança não encontrada.");
    if (receivable.status === "cancelled") throw new Error("Uma cobrança cancelada não pode receber movimentações.");
    const previousPayments = await tx.select().from(financePayments).where(eq(financePayments.receivableId, receivable.id));
    const current = hydrateReceivable(receivable, previousPayments);
    const allowedAmount = input.type === "receipt" ? current.remainingAmount : current.receivedAmount;
    if (roundMoney(input.amount) > allowedAmount) throw new Error(input.type === "receipt" ? `O recebimento excede o saldo de ${allowedAmount.toFixed(2)}.` : `O estorno excede o valor recebido de ${allowedAmount.toFixed(2)}.`);
    const result = await tx.insert(financePayments).values({
      receivableId: receivable.id,
      type: input.type,
      amount: money(input.amount),
      paymentMethod: input.paymentMethod,
      paidAt: input.paidAt,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      createdByUserId,
    }).$returningId();
    const receivedAmount = roundMoney(current.receivedAmount + (input.type === "receipt" ? input.amount : -input.amount));
    const calculated = calculateReceivableStatus({ originalAmount: current.originalAmount, receivedAmount, cancelled: false, dueDate: receivable.dueDate });
    await tx.update(financeReceivables).set({ status: calculated === "overdue" ? "open" : calculated }).where(eq(financeReceivables.id, receivable.id));
    return { paymentId: result[0]!.id, status: calculated, receivedAmount, remainingAmount: remainingReceivableAmount(current.originalAmount, receivedAmount) };
  });
}

export async function cancelReceivable(id: number) {
  const db = await database();
  return db.transaction(async (tx) => {
    const receivable = (await tx.select().from(financeReceivables).where(eq(financeReceivables.id, id)).limit(1))[0];
    if (!receivable) throw new Error("Cobrança não encontrada.");
    const payments = await tx.select().from(financePayments).where(eq(financePayments.receivableId, id));
    const current = hydrateReceivable(receivable, payments);
    if (current.receivedAmount > 0) throw new Error("Estorne os recebimentos antes de cancelar esta cobrança.");
    await tx.update(financeReceivables).set({ status: "cancelled" }).where(eq(financeReceivables.id, id));
    return { cancelled: true } as const;
  });
}

export async function financeClients() {
  const db = await database();
  return db.select({ id: clients.id, name: clients.name, professional: clients.professional }).from(clients).orderBy(clients.name);
}

export async function financeByQuote(quoteId: number) {
  const overview = await financeOverview();
  return overview.receivables.filter((receivable) => receivable.quoteId === quoteId);
}
