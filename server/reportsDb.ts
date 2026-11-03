import { desc, eq } from "drizzle-orm";
import { commissionPayments, products, professionals, users } from "../drizzle/schema";
import { commissionAmount, commissionBase, professionalKey } from "../shared/commission";
import { isFollowUpDue } from "../shared/followUp";
import { canAccess } from "../shared/permissions";
import { buildSalesReport, type SalesReportProduct } from "../shared/salesReport";
import { roundMoney, toNumber } from "../shared/quote";
import type { DailySummary } from "../shared/dailySummary";
import { listAppointments } from "./agendaDb";
import { getDb } from "./db";
import { financeOverview } from "./financeDb";
import { getSettings, listQuotes } from "./quoteDb";
import { approvedFulfillments, purchaseSuggestions } from "./stockDb";
import { afterSalesDue } from "./afterSalesDb";
import { loansDue } from "./loansDb";
import { readBackupStatus } from "./backupStatus";
import { needsBackupAttention } from "../shared/backupStatus";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

type Range = { from: Date; to: Date };
const inRange = (date: Date | null | undefined, range: Range) => Boolean(date) && date! >= range.from && date! < range.to;

// ---------------------------------------------------------------- vendas

export async function salesReport(range: Range) {
  const db = await database();
  const [allQuotes, productRows, userRows] = await Promise.all([
    listQuotes(),
    db.select({ id: products.id, parentId: products.parentId, modelName: products.modelName, shortDescription: products.shortDescription }).from(products),
    db.select({ id: users.id, name: users.name, username: users.username }).from(users),
  ]);
  const sold = allQuotes.filter((quote) => quote.status === "approved" && inRange(quote.approvedAt, range));
  const byId = new Map(productRows.map((product) => [product.id, product]));
  const productInfo = new Map<number, SalesReportProduct>();
  for (const product of productRows) {
    const root = product.parentId ? byId.get(product.parentId) ?? product : product;
    const isFamily = Boolean(product.parentId) || Boolean(product.modelName);
    productInfo.set(product.id, { modelKey: `model-${root.id}`, modelName: isFamily ? root.modelName || root.shortDescription : product.shortDescription });
  }
  const userNames = new Map(userRows.map((user) => [user.id, user.name || user.username || `Usuário #${user.id}`]));
  return buildSalesReport(sold.map((quote) => ({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    approvedAt: quote.approvedAt!,
    clientName: quote.clientName,
    professional: quote.professional,
    sellerName: quote.sellerUserId ? userNames.get(quote.sellerUserId) ?? "" : "",
    total: quote.summary.total,
    shipping: quote.summary.shipping,
    productsSubtotal: quote.summary.productsSubtotal,
    discountAmount: quote.summary.discountAmount,
    items: quote.rooms.flatMap((room) => room.items.map((item) => ({
      productId: item.productId,
      code: item.code,
      shortDescription: item.shortDescription,
      unit: item.unit,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      unitCost: item.unitCost === null ? null : toNumber(item.unitCost),
    }))),
  })), productInfo);
}

// ------------------------------------------------------------- comissões

export async function listProfessionals() {
  const db = await database();
  return db.select().from(professionals).orderBy(professionals.name);
}

// Percentual em vigor para um profissional: o cadastrado ou o padrão da loja.
export async function commissionRateFor(name: string | null | undefined) {
  const key = professionalKey(name);
  if (!key) return null;
  const [rows, settings] = await Promise.all([listProfessionals(), getSettings()]);
  const row = rows.find((entry) => professionalKey(entry.name) === key);
  return row?.commissionPercent !== null && row?.commissionPercent !== undefined ? toNumber(row.commissionPercent) : toNumber(settings.defaultCommissionPercent);
}

export async function saveProfessional(input: { name: string; commissionPercent: number | null; phone?: string | null }) {
  const db = await database();
  const name = input.name.trim().replace(/\s+/g, " ");
  const existing = (await listProfessionals()).find((entry) => professionalKey(entry.name) === professionalKey(name));
  const values = { commissionPercent: input.commissionPercent === null ? null : input.commissionPercent.toFixed(2), phone: input.phone || null };
  if (existing) {
    await db.update(professionals).set(values).where(eq(professionals.id, existing.id));
    return existing.id;
  }
  const inserted = await db.insert(professionals).values({ name, ...values }).$returningId();
  return inserted[0]!.id;
}

export async function recordCommissionPayment(input: { professional: string; amount: number; paidAt: Date; notes?: string | null }, userId: number) {
  const db = await database();
  const inserted = await db.insert(commissionPayments).values({ professional: input.professional.trim().replace(/\s+/g, " "), amount: input.amount.toFixed(2), paidAt: input.paidAt, notes: input.notes || null, createdByUserId: userId }).$returningId();
  return inserted[0]!.id;
}

export async function deleteCommissionPayment(id: number) {
  const db = await database();
  const row = (await db.select().from(commissionPayments).where(eq(commissionPayments.id, id)).limit(1))[0];
  if (!row) throw new Error("Pagamento de comissão não encontrado.");
  await db.delete(commissionPayments).where(eq(commissionPayments.id, id));
  return { ...row, amount: toNumber(row.amount) };
}

// Comissão de cada profissional: gerada conforme o cliente paga (sem o
// frete), pelo percentual fixado na aprovação do orçamento. O saldo a pagar
// considera todo o histórico; as demais colunas, o período escolhido.
export async function commissionReport(range: Range) {
  const db = await database();
  const [allQuotes, finance, people, payments, settings] = await Promise.all([
    listQuotes(),
    financeOverview(),
    listProfessionals(),
    db.select().from(commissionPayments).orderBy(desc(commissionPayments.paidAt), desc(commissionPayments.id)),
    getSettings(),
  ]);
  const defaultPercent = toNumber(settings.defaultCommissionPercent);
  const rateByKey = new Map(people.map((person) => [professionalKey(person.name), person.commissionPercent === null ? null : toNumber(person.commissionPercent)]));
  const paymentsByQuote = new Map<number, Array<{ amount: number; paidAt: Date }>>();
  for (const receivable of finance.receivables) {
    if (!receivable.quoteId || receivable.status === "cancelled") continue;
    const list = paymentsByQuote.get(receivable.quoteId) ?? [];
    receivable.payments.forEach((payment) => list.push({ amount: payment.type === "reversal" ? -payment.amount : payment.amount, paidAt: payment.paidAt }));
    paymentsByQuote.set(receivable.quoteId, list);
  }
  type Entry = {
    key: string; name: string; currentPercent: number; registered: boolean; phone: string | null;
    soldInPeriod: number; receivedInPeriod: number; commissionInPeriod: number; paidInPeriod: number;
    earnedTotal: number; paidTotal: number;
    quotes: Array<{ id: number; quoteNumber: number; clientName: string; approvedAt: Date | null; total: number; received: number; percent: number; commission: number }>;
    payments: Array<{ id: number; amount: number; paidAt: Date; notes: string | null }>;
  };
  const entries = new Map<string, Entry>();
  const entryFor = (name: string) => {
    const key = professionalKey(name);
    let entry = entries.get(key);
    if (!entry) {
      const person = people.find((row) => professionalKey(row.name) === key);
      const rate = rateByKey.get(key);
      entry = { key, name: person?.name ?? name.trim().replace(/\s+/g, " "), currentPercent: rate ?? defaultPercent, registered: Boolean(person), phone: person?.phone ?? null, soldInPeriod: 0, receivedInPeriod: 0, commissionInPeriod: 0, paidInPeriod: 0, earnedTotal: 0, paidTotal: 0, quotes: [], payments: [] };
      entries.set(key, entry);
    }
    return entry;
  };
  people.forEach((person) => entryFor(person.name));
  for (const quote of allQuotes) {
    if (quote.status !== "approved" || !professionalKey(quote.professional)) continue;
    const entry = entryFor(quote.professional);
    const percent = quote.commissionPercent !== null ? toNumber(quote.commissionPercent) : entry.currentPercent;
    const quotePayments = paymentsByQuote.get(quote.id) ?? [];
    const received = quotePayments.reduce((sum, payment) => sum + payment.amount, 0);
    const receivedInPeriod = quotePayments.filter((payment) => inRange(payment.paidAt, range)).reduce((sum, payment) => sum + payment.amount, 0);
    const commission = commissionAmount(commissionBase(received, quote.summary.total, quote.summary.shipping), percent);
    entry.earnedTotal += commission;
    entry.receivedInPeriod += receivedInPeriod;
    entry.commissionInPeriod += commissionAmount(commissionBase(receivedInPeriod, quote.summary.total, quote.summary.shipping), percent);
    if (inRange(quote.approvedAt, range)) entry.soldInPeriod += quote.summary.total;
    if (inRange(quote.approvedAt, range) || receivedInPeriod !== 0) {
      entry.quotes.push({ id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, approvedAt: quote.approvedAt, total: quote.summary.total, received: roundMoney(received), percent, commission });
    }
  }
  for (const payment of payments) {
    const entry = entryFor(payment.professional);
    const amount = toNumber(payment.amount);
    entry.paidTotal += amount;
    if (inRange(payment.paidAt, range)) {
      entry.paidInPeriod += amount;
      entry.payments.push({ id: payment.id, amount, paidAt: payment.paidAt, notes: payment.notes });
    }
  }
  const rows = Array.from(entries.values()).map((entry) => ({
    ...entry,
    soldInPeriod: roundMoney(entry.soldInPeriod),
    receivedInPeriod: roundMoney(entry.receivedInPeriod),
    commissionInPeriod: roundMoney(entry.commissionInPeriod),
    paidInPeriod: roundMoney(entry.paidInPeriod),
    earnedTotal: roundMoney(entry.earnedTotal),
    paidTotal: roundMoney(entry.paidTotal),
    balance: roundMoney(entry.earnedTotal - entry.paidTotal),
    quotes: entry.quotes.sort((first, second) => second.quoteNumber - first.quoteNumber),
  })).sort((first, second) => second.balance - first.balance || second.soldInPeriod - first.soldInPeriod || first.name.localeCompare(second.name, "pt-BR"));
  return {
    defaultPercent,
    professionals: rows,
    totals: {
      soldInPeriod: roundMoney(rows.reduce((sum, row) => sum + row.soldInPeriod, 0)),
      commissionInPeriod: roundMoney(rows.reduce((sum, row) => sum + row.commissionInPeriod, 0)),
      paidInPeriod: roundMoney(rows.reduce((sum, row) => sum + row.paidInPeriod, 0)),
      balance: roundMoney(rows.reduce((sum, row) => sum + row.balance, 0)),
    },
  };
}

// --------------------------------------------------------- resumo do dia

// O que pede atenção hoje, conforme o perfil de quem está vendo.
export async function dailySummary(role: string, now = new Date()): Promise<DailySummary> {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const can = (area: Parameters<typeof canAccess>[1]) => canAccess(role, area);
  const [allQuotes, finance, purchases, fulfillments, appointmentRows, afterSalesRows, backup, loanRows] = await Promise.all([
    can("quotes") ? listQuotes() : Promise.resolve(null),
    can("finance") ? financeOverview() : Promise.resolve(null),
    can("purchases") ? purchaseSuggestions() : Promise.resolve(null),
    can("stock") ? approvedFulfillments() : Promise.resolve(null),
    can("agenda") ? listAppointments({ from: startOfDay, to: endOfDay }) : Promise.resolve(null),
    can("aftersales") ? afterSalesDue(now) : Promise.resolve(null),
    role === "admin" ? readBackupStatus(now) : Promise.resolve(null),
    can("loans") ? loansDue(now) : Promise.resolve(null),
  ]);

  const negotiating = allQuotes?.filter((quote) => quote.status === "open" || quote.status === "draft") ?? [];
  const followUps = negotiating
    .filter((quote) => isFollowUpDue(quote.followUpAt, now))
    .sort((first, second) => new Date(first.followUpAt!).getTime() - new Date(second.followUpAt!).getTime())
    .map((quote) => ({ id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, total: quote.summary.total, late: new Date(quote.followUpAt!) < startOfDay }));
  const expiring = negotiating
    .filter((quote) => quote.validUntil && quote.validUntil >= startOfDay && quote.validUntil < endOfDay)
    .map((quote) => ({ id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, total: quote.summary.total }));

  const dueReceivables = finance?.receivables.filter((row) => row.status !== "cancelled" && row.status !== "paid" && row.remainingAmount > 0 && row.dueDate < endOfDay) ?? [];
  const overdue = dueReceivables.filter((row) => row.dueDate < startOfDay);
  const dueToday = dueReceivables.filter((row) => row.dueDate >= startOfDay);

  const shortageLines = purchases?.flatMap((group) => group.lines.filter((line) => line.shortageQuantity > 0).map((line) => ({ ...line, supplierName: group.supplierName }))) ?? [];
  const waitingQuotes = new Set(shortageLines.flatMap((line) => line.waitingQuotes.map((entry) => entry.quoteId)));

  const readyByQuote = new Map<number, { quoteId: number; quoteNumber: number; clientName: string; lines: number }>();
  fulfillments?.filter((line) => line.deliverableQuantity > 0).forEach((line) => {
    const entry = readyByQuote.get(line.quoteId) ?? { quoteId: line.quoteId, quoteNumber: line.quoteNumber, clientName: line.clientName, lines: 0 };
    entry.lines += 1;
    readyByQuote.set(line.quoteId, entry);
  });

  const scheduled = appointmentRows?.filter((row) => row.status === "scheduled") ?? [];
  const sum = (rows: Array<{ remainingAmount: number }>) => roundMoney(rows.reduce((total, row) => total + row.remainingAmount, 0));

  return {
    date: startOfDay,
    followUps: allQuotes ? { count: followUps.length, items: followUps.slice(0, 6) } : null,
    expiring: allQuotes ? { count: expiring.length, items: expiring.slice(0, 6) } : null,
    installments: finance ? {
      dueToday: { count: dueToday.length, amount: sum(dueToday) },
      overdue: { count: overdue.length, amount: sum(overdue) },
      items: [...dueToday, ...overdue].slice(0, 6).map((row) => ({ id: row.id, clientName: row.clientName, quoteNumber: row.quoteNumber, installmentNumber: row.installmentNumber, installmentCount: row.installmentCount, remainingAmount: row.remainingAmount, dueDate: row.dueDate, overdue: row.dueDate < startOfDay })),
    } : null,
    purchases: purchases ? {
      products: shortageLines.length,
      quotesWaiting: waitingQuotes.size,
      items: shortageLines.slice(0, 6).map((line) => ({ productId: line.productId, shortDescription: line.shortDescription, unit: line.unit, quantity: line.shortageQuantity, supplierName: line.supplierName || null })),
    } : null,
    deliveries: fulfillments ? { count: readyByQuote.size, items: Array.from(readyByQuote.values()).slice(0, 6) } : null,
    appointments: appointmentRows ? {
      count: scheduled.length,
      items: scheduled.slice(0, 8).map((row) => ({ id: row.id, type: row.type, clientName: row.clientName, scheduledAt: row.scheduledAt, responsible: row.responsible, quoteNumber: row.quoteNumber })),
    } : null,
    loans: loanRows ? { count: loanRows.length, items: loanRows.slice(0, 6) } : null,
    afterSales: afterSalesRows ? { count: afterSalesRows.length, items: afterSalesRows.slice(0, 6) } : null,
    backup: backup && needsBackupAttention(backup.state) ? { state: backup.state, lastSuccessAt: backup.lastSuccessAt, error: backup.error } : null,
  };
}

