import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { clients, financePayments, financeReceivables, quotes, storeSettings } from "../drizzle/schema";
import { cardFeeAmount, dateFromInput, isBilledMethod, parseCardFees, PLAN_METHOD_LABELS, type PaymentPlan } from "../shared/paymentPlan";
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
    payments: payments.map((payment) => ({ ...payment, amount: toNumber(payment.amount), feeAmount: payment.feeAmount === null ? null : toNumber(payment.feeAmount) })),
  };
}

export async function financeOverview() {
  const db = await database();
  const [receivables, payments, quoteRows] = await Promise.all([
    db.select().from(financeReceivables).orderBy(financeReceivables.dueDate, desc(financeReceivables.id)),
    // Sem limite: os saldos de cada cobrança são somados a partir destes
    // pagamentos, e cortar a lista faria cobranças antigas parecerem em aberto.
    db.select().from(financePayments).orderBy(desc(financePayments.paidAt), desc(financePayments.id)),
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
  // Taxas da maquininha dos recebimentos do mês.
  const cardFeesThisMonth = payments.filter((payment) => payment.type === "receipt" && payment.paidAt >= monthStart && payment.feeAmount).reduce((sum, payment) => sum + toNumber(payment.feeAmount), 0);
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
      cardFeesThisMonth: roundMoney(cardFeesThisMonth),
    },
  };
}

export async function createReceivables(input: { quoteId?: number | null; clientId?: number | null; clientName: string; description: string; totalAmount: number; installmentCount: number; firstDueDate: Date; paymentMethod?: PaymentMethod | null }, createdByUserId: number) {
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw new Error("O valor da cobrança deve ser maior que zero.");
  const db = await database();
  return db.transaction((tx) => insertReceivables(tx, input, createdByUserId));
}

type Transaction = Parameters<Parameters<Awaited<ReturnType<typeof database>>["transaction"]>[0]>[0];
type ReceivableInput = Parameters<typeof createReceivables>[0];

async function insertReceivables(tx: Transaction, input: ReceivableInput, createdByUserId: number) {
  const installmentCount = Math.max(1, Math.min(24, Math.floor(input.installmentCount)));
  const installments = splitInstallments(input.totalAmount, installmentCount);
  const inserted = [] as number[];
  for (let index = 0; index < installments.length; index += 1) {
    const result = await tx.insert(financeReceivables).values({
      quoteId: input.quoteId || null,
      clientId: input.clientId || null,
      clientName: input.clientName.trim() || "Cliente não informado",
      description: input.description.trim() || "Cobrança avulsa",
      installmentNumber: index + 1,
      installmentCount,
      paymentMethod: input.paymentMethod ?? null,
      originalAmount: money(installments[index]!),
      dueDate: dueDateForInstallment(input.firstDueDate, index + 1),
      status: "open",
      createdByUserId,
    }).$returningId();
    inserted.push(result[0]!.id);
  }
  return inserted;
}

type QuoteForReceivables = { id: number; quoteNumber: number; clientId: number | null; clientName: string; installments: number; issueDate: Date; summary: { total: number }; paymentPlan?: PaymentPlan | null };

// Cobranças da venda conforme a forma de pagamento escolhida na aprovação:
// - cartão, PIX, dinheiro e transferência: um lançamento já recebido (no
//   cartão, quem parcela é a operadora; a loja já registra o recebimento e a
//   taxa da maquininha);
// - boleto e crediário próprio: parcelas mensais a partir da data escolhida.
// Sem forma escolhida (orçamentos antigos), mantém o comportamento anterior.
async function insertPlanReceivables(tx: Transaction, quote: QuoteForReceivables, plan: PaymentPlan, createdByUserId: number, now = new Date()) {
  const feesRow = (await tx.select({ cardFees: storeSettings.cardFees }).from(storeSettings).where(eq(storeSettings.id, 1)).limit(1))[0];
  const fees = parseCardFees(feesRow?.cardFees);
  const ids: number[] = [];
  for (const part of plan.parts) {
    const label = PLAN_METHOD_LABELS[part.method];
    const description = `Orçamento #${quote.quoteNumber} — ${label}${part.installments > 1 && !isBilledMethod(part.method) ? ` em ${part.installments}x` : ""}`;
    if (isBilledMethod(part.method)) {
      ids.push(...await insertReceivables(tx, { quoteId: quote.id, clientId: quote.clientId, clientName: quote.clientName, description, totalAmount: part.amount, installmentCount: part.installments, firstDueDate: dateFromInput(part.firstDueDate!), paymentMethod: part.method }, createdByUserId));
      continue;
    }
    const [receivableId] = await insertReceivables(tx, { quoteId: quote.id, clientId: quote.clientId, clientName: quote.clientName, description, totalAmount: part.amount, installmentCount: 1, firstDueDate: now, paymentMethod: part.method }, createdByUserId);
    const fee = cardFeeAmount(fees, part.method, part.installments, part.amount);
    await tx.insert(financePayments).values({
      receivableId: receivableId!,
      type: "receipt",
      amount: money(part.amount),
      paymentMethod: part.method,
      feeAmount: fee > 0 ? money(fee) : null,
      paidAt: now,
      reference: "Registrado na aprovação",
      notes: part.method === "credit_card" && part.installments > 1 ? `${part.installments}x na maquininha` : null,
      createdByUserId,
    });
    await tx.update(financeReceivables).set({ status: "paid" }).where(eq(financeReceivables.id, receivableId!));
    ids.push(receivableId!);
  }
  return ids;
}

export async function createReceivablesFromQuote(input: QuoteForReceivables, createdByUserId: number) {
  if (!(input.summary.total > 0)) return { created: false, ids: [] as number[] };
  const db = await database();
  return db.transaction(async (tx) => {
    // Trava a linha do orçamento: dois salvamentos "aprovado" simultâneos
    // passariam juntos pela checagem abaixo e gerariam parcelas em dobro.
    await tx.execute(sql`SELECT id FROM ${quotes} WHERE ${eq(quotes.id, input.id)} FOR UPDATE`);
    // Canceladas não contam: ao reaprovar, a venda ganha cobranças novas.
    const existing = await tx.select({ id: financeReceivables.id }).from(financeReceivables).where(and(eq(financeReceivables.quoteId, input.id), ne(financeReceivables.status, "cancelled"))).limit(1);
    if (existing.length) return { created: false, ids: [] as number[] };
    const ids = input.paymentPlan?.parts.length
      ? await insertPlanReceivables(tx, input, input.paymentPlan, createdByUserId)
      : await insertReceivables(tx, { quoteId: input.id, clientId: input.clientId, clientName: input.clientName, description: `Orçamento #${input.quoteNumber}`, totalAmount: input.summary.total, installmentCount: input.installments, firstDueDate: input.issueDate }, createdByUserId);
    return { created: true, ids };
  });
}

// Ao tirar um orçamento de Aprovado: as cobranças sem recebimento são
// canceladas (a reaprovação gera as novas). Com dinheiro já recebido, não sai.
export async function releaseQuoteReceivables(tx: Transaction, quoteId: number) {
  const receivables = await tx.select().from(financeReceivables).where(and(eq(financeReceivables.quoteId, quoteId), ne(financeReceivables.status, "cancelled")));
  if (!receivables.length) return;
  const payments = await tx.select().from(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
  const received = receivables.some((receivable) => hydrateReceivable(receivable, payments.filter((payment) => payment.receivableId === receivable.id)).receivedAmount > 0);
  if (received) throw new Error("Este orçamento já tem recebimentos no Financeiro e não pode sair do status Aprovado. Estorne os recebimentos antes, se a venda mudou.");
  await tx.update(financeReceivables).set({ status: "cancelled" }).where(inArray(financeReceivables.id, receivables.map((row) => row.id)));
}

export type { Transaction as FinanceTransaction };

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
    // "overdue" é calculado na leitura; no banco fica o estado de pagamento.
    const stored = calculated === "overdue" ? (receivedAmount > 0 ? "partial" : "open") : calculated;
    await tx.update(financeReceivables).set({ status: stored }).where(eq(financeReceivables.id, receivable.id));
    return { paymentId: result[0]!.id, status: calculated, receivedAmount, remainingAmount: remainingReceivableAmount(current.originalAmount, receivedAmount) };
  });
}

export async function cancelReceivable(id: number) {
  const db = await database();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${financeReceivables} WHERE ${eq(financeReceivables.id, id)} FOR UPDATE`);
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

export async function getReceivableSummary(id: number) {
  const db = await database();
  const rows = await db.select({ receivable: financeReceivables, quoteNumber: quotes.quoteNumber }).from(financeReceivables).leftJoin(quotes, eq(financeReceivables.quoteId, quotes.id)).where(eq(financeReceivables.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row.receivable, quoteNumber: row.quoteNumber ?? null, originalAmount: toNumber(row.receivable.originalAmount) };
}

export async function financeByQuote(quoteId: number) {
  const overview = await financeOverview();
  return overview.receivables.filter((receivable) => receivable.quoteId === quoteId);
}

// Aprovados antes da forma de pagamento: parcelas mensais criadas para toda
// venda, inclusive as pagas no cartão. Lista os que ainda não têm recebimento
// para a loja dizer como foi.
export async function legacyApprovedQuotes() {
  const db = await database();
  const quoteRows = await db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber, clientName: quotes.clientName, approvedAt: quotes.approvedAt }).from(quotes).where(and(eq(quotes.status, "approved"), isNull(quotes.paymentPlan)));
  if (!quoteRows.length) return [];
  const receivables = await db.select().from(financeReceivables).where(and(inArray(financeReceivables.quoteId, quoteRows.map((row) => row.id)), ne(financeReceivables.status, "cancelled")));
  const payments = receivables.length ? await db.select().from(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id))) : [];
  return quoteRows.flatMap((quote) => {
    const mine = receivables.filter((row) => row.quoteId === quote.id).sort((first, second) => first.dueDate.getTime() - second.dueDate.getTime());
    if (mine.length < 2 || payments.some((payment) => mine.some((row) => row.id === payment.receivableId))) return [];
    return [{ ...quote, installments: mine.length, amount: roundMoney(mine.reduce((sum, row) => sum + toNumber(row.originalAmount), 0)), firstDueDate: mine[0]!.dueDate }];
  });
}

const inputDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// "Foi no cartão": cancela as parcelas e registra o recebimento na maquininha.
// "Manter parcelas": só anota se são de boleto ou crediário.
export async function settleLegacyQuote(input: { quoteId: number; method: "credit_card" | "boleto" | "store_credit"; installments: number; paidAt: Date }, createdByUserId: number) {
  const candidate = (await legacyApprovedQuotes()).find((row) => row.id === input.quoteId);
  if (!candidate) throw new Error("Este orçamento não está mais na lista de revisão.");
  const db = await database();
  await db.transaction(async (tx) => {
    const receivables = await tx.select().from(financeReceivables).where(and(eq(financeReceivables.quoteId, input.quoteId), ne(financeReceivables.status, "cancelled")));
    let plan: PaymentPlan;
    if (input.method === "credit_card") {
      plan = { parts: [{ method: "credit_card", amount: candidate.amount, installments: input.installments, firstDueDate: null }] };
      await tx.update(financeReceivables).set({ status: "cancelled" }).where(inArray(financeReceivables.id, receivables.map((row) => row.id)));
      await insertPlanReceivables(tx, { id: input.quoteId, quoteNumber: candidate.quoteNumber, clientId: receivables[0]?.clientId ?? null, clientName: candidate.clientName, installments: input.installments, issueDate: input.paidAt, summary: { total: candidate.amount } }, plan, createdByUserId, input.paidAt);
    } else {
      plan = { parts: [{ method: input.method, amount: candidate.amount, installments: candidate.installments, firstDueDate: inputDate(candidate.firstDueDate) }] };
      await tx.update(financeReceivables).set({ paymentMethod: input.method }).where(inArray(financeReceivables.id, receivables.map((row) => row.id)));
    }
    await tx.update(quotes).set({ paymentPlan: JSON.stringify(plan) }).where(eq(quotes.id, input.quoteId));
  });
  return candidate;
}
