import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { afterSalesCases, products, quoteItemDeliveries, quoteItems, quoteRooms, quotes } from "../drizzle/schema";
import { AFTER_SALES_TYPE_LABELS, buildAfterSalesReport, isActiveCase, isCaseOverdue, warrantyUntil, isUnderWarranty, type AfterSalesReason, type AfterSalesStatus, type AfterSalesType } from "../shared/afterSales";
import { toNumber } from "../shared/quote";
import { getDb } from "./db";
import { getSettings } from "./quoteDb";
import { moveStock } from "./stockDb";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

const round = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => value.toFixed(2);

// Vendas que podem ter pós-venda: só orçamentos aprovados.
export async function afterSalesSales() {
  const db = await database();
  return db
    .select({ id: quotes.id, quoteNumber: quotes.quoteNumber, clientName: quotes.clientName, approvedAt: quotes.approvedAt })
    .from(quotes)
    .where(eq(quotes.status, "approved"))
    .orderBy(desc(quotes.approvedAt), desc(quotes.id))
    .limit(500);
}

// Itens de uma venda com garantia e quanto ainda pode entrar em pós-venda.
export async function afterSalesItems(quoteId: number, now = new Date()) {
  const db = await database();
  const quote = (await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0];
  if (!quote) throw new Error("Orçamento não encontrado.");
  if (quote.status !== "approved") throw new Error("Pós-venda só vale para orçamentos aprovados.");
  const items = await db
    .select({ id: quoteItems.id, productId: quoteItems.productId, code: quoteItems.code, shortDescription: quoteItems.shortDescription, unit: quoteItems.unit, quantity: quoteItems.quantity, roomName: quoteRooms.name })
    .from(quoteItems)
    .innerJoin(quoteRooms, eq(quoteItems.quoteRoomId, quoteRooms.id))
    .where(eq(quoteRooms.quoteId, quoteId))
    .orderBy(asc(quoteRooms.sortOrder), asc(quoteItems.sortOrder));
  const itemIds = items.map((item) => item.id);
  const productIds = items.flatMap((item) => (item.productId ? [item.productId] : []));
  const [deliveries, productRows, cases, settings] = await Promise.all([
    itemIds.length ? db.select({ quoteItemId: quoteItemDeliveries.quoteItemId, deliveredAt: quoteItemDeliveries.deliveredAt }).from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, itemIds)) : [],
    productIds.length ? db.select({ id: products.id, warrantyMonths: products.warrantyMonths, supplierName: products.supplierName }).from(products).where(inArray(products.id, productIds)) : [],
    itemIds.length ? db.select({ quoteItemId: afterSalesCases.quoteItemId, quantity: afterSalesCases.quantity, status: afterSalesCases.status }).from(afterSalesCases).where(inArray(afterSalesCases.quoteItemId, itemIds)) : [],
    getSettings(),
  ]);
  const productById = new Map(productRows.map((row) => [row.id, row]));
  return {
    quote: { id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, approvedAt: quote.approvedAt },
    items: items.map((item) => {
      const delivered = deliveries.filter((row) => row.quoteItemId === item.id).map((row) => row.deliveredAt.getTime());
      const deliveredAt = delivered.length ? new Date(Math.min(...delivered)) : null;
      const product = item.productId ? productById.get(item.productId) : undefined;
      const months = product?.warrantyMonths ?? settings.defaultWarrantyMonths;
      const until = warrantyUntil(deliveredAt ?? quote.approvedAt, months);
      const used = round(cases.filter((row) => row.quoteItemId === item.id && row.status !== "rejected").reduce((sum, row) => sum + toNumber(row.quantity), 0));
      const quantity = toNumber(item.quantity);
      return {
        quoteItemId: item.id,
        productId: item.productId,
        code: item.code,
        shortDescription: item.shortDescription,
        unit: item.unit,
        roomName: item.roomName,
        quantity,
        available: round(Math.max(0, quantity - used)),
        deliveredAt,
        warrantyMonths: months,
        warrantyUntil: until,
        underWarranty: isUnderWarranty(until, now),
      };
    }),
  };
}

export type AfterSalesCaseRow = Awaited<ReturnType<typeof listAfterSalesCases>>[number];

export async function listAfterSalesCases(filter: { quoteId?: number } = {}, now = new Date()) {
  const db = await database();
  const rows = await db
    .select({ caseRow: afterSalesCases, quoteNumber: quotes.quoteNumber })
    .from(afterSalesCases)
    .leftJoin(quotes, eq(afterSalesCases.quoteId, quotes.id))
    .where(filter.quoteId ? eq(afterSalesCases.quoteId, filter.quoteId) : undefined)
    .orderBy(desc(afterSalesCases.openedAt), desc(afterSalesCases.id));
  const list = rows.map(({ caseRow, quoteNumber }) => ({
    ...caseRow,
    quoteNumber,
    quantity: toNumber(caseRow.quantity),
    refundAmount: caseRow.refundAmount === null ? null : toNumber(caseRow.refundAmount),
    active: isActiveCase(caseRow.status),
    overdue: isCaseOverdue(caseRow, now),
  }));
  // Em andamento primeiro, pelo prazo; depois os encerrados, mais recentes antes.
  return list.sort((first, second) =>
    Number(second.active) - Number(first.active)
    || (first.active ? first.dueDate.getTime() - second.dueDate.getTime() : 0));
}

export async function createAfterSalesCase(input: {
  quoteId: number;
  quoteItemId: number;
  type: AfterSalesType;
  reason: AfterSalesReason;
  quantity: number;
  dueDate: Date;
  description?: string | null;
}, userId: number) {
  const { quote, items } = await afterSalesItems(input.quoteId);
  const item = items.find((entry) => entry.quoteItemId === input.quoteItemId);
  if (!item) throw new Error("Item não encontrado neste orçamento.");
  if (input.quantity > item.available) {
    throw new Error(item.available > 0 ? `Só ${item.available} ${item.unit} deste item ainda podem entrar em pós-venda.` : "Todas as unidades deste item já estão em outras ocorrências de pós-venda.");
  }
  const db = await database();
  const product = item.productId ? (await db.select({ supplierName: products.supplierName }).from(products).where(eq(products.id, item.productId)).limit(1))[0] : undefined;
  const inserted = await db.insert(afterSalesCases).values({
    quoteId: quote.id,
    quoteItemId: item.quoteItemId,
    productId: item.productId,
    clientName: quote.clientName || "Cliente sem nome",
    productDescription: item.shortDescription,
    supplierName: product?.supplierName || null,
    type: input.type,
    reason: input.reason,
    quantity: money(input.quantity),
    description: input.description || null,
    dueDate: input.dueDate,
    createdByUserId: userId,
  }).$returningId();
  return getAfterSalesCase(inserted[0]!.id);
}

export async function getAfterSalesCase(id: number) {
  const db = await database();
  const row = (await db.select({ caseRow: afterSalesCases, quoteNumber: quotes.quoteNumber }).from(afterSalesCases).leftJoin(quotes, eq(afterSalesCases.quoteId, quotes.id)).where(eq(afterSalesCases.id, id)).limit(1))[0];
  if (!row) return null;
  return { ...row.caseRow, quoteNumber: row.quoteNumber, quantity: toNumber(row.caseRow.quantity), refundAmount: row.caseRow.refundAmount === null ? null : toNumber(row.caseRow.refundAmount) };
}

export async function updateAfterSalesCase(input: {
  id: number;
  status: AfterSalesStatus;
  dueDate: Date;
  description?: string | null;
  resolution?: string | null;
  refundAmount?: number | null;
  // Ao resolver: peça devolvida volta ao estoque / peça nova sai do estoque.
  restock?: boolean;
  replacement?: boolean;
  responsible?: string | null;
}) {
  const db = await database();
  const before = await getAfterSalesCase(input.id);
  if (!before) throw new Error("Ocorrência não encontrada.");
  const closing = input.status === "resolved" || input.status === "rejected";
  if (closing && !input.resolution?.trim()) throw new Error(input.status === "resolved" ? "Descreva como a ocorrência foi resolvida." : "Informe por que a ocorrência foi recusada.");
  const restock = input.status === "resolved" && Boolean(input.restock) && !before.restockMovementId;
  const replacement = input.status === "resolved" && Boolean(input.replacement) && !before.replacementMovementId;
  if ((restock || replacement) && !before.productId) throw new Error("Item avulso, sem produto no catálogo: não há estoque para movimentar.");
  if (restock && before.type === "warranty") throw new Error("Na garantia a peça vai para o fornecedor; use Devolução ou Troca para voltar ao estoque.");
  if (replacement && before.type === "return") throw new Error("Devolução não entrega peça nova; use Troca ou Garantia.");
  const label = `Pós-venda #${before.id} (${AFTER_SALES_TYPE_LABELS[before.type].toLowerCase()})`;
  const stockBase = { productId: before.productId!, quantity: before.quantity, occurredAt: new Date(), responsible: input.responsible || null, quoteId: before.quoteId, quoteItemId: before.quoteItemId, clientName: before.clientName };
  await db.transaction(async (tx) => {
    const restockMovement = restock ? await moveStock(tx, { ...stockBase, type: "return", notes: `${label}: peça devolvida pelo cliente` }) : null;
    // Saída sem ser retirada de orçamento: ajuste negativo, que respeita as reservas.
    const replacementMovement = replacement ? await moveStock(tx, { ...stockBase, type: "adjustment", quantity: -before.quantity, notes: `${label}: peça nova entregue ao cliente` }) : null;
    await tx.update(afterSalesCases).set({
      status: input.status,
      dueDate: input.dueDate,
      description: input.description || null,
      resolution: input.resolution?.trim() || null,
      refundAmount: input.refundAmount ? money(input.refundAmount) : null,
      resolvedAt: closing ? before.resolvedAt ?? new Date() : null,
      ...(restockMovement ? { restockMovementId: restockMovement.movementId } : {}),
      ...(replacementMovement ? { replacementMovementId: replacementMovement.movementId } : {}),
    }).where(eq(afterSalesCases.id, input.id));
  });
  return { before, after: (await getAfterSalesCase(input.id))!, restocked: restock, replaced: replacement };
}

export async function afterSalesReport(range: { from: Date; to: Date }, now = new Date()) {
  const db = await database();
  const [cases, soldRows] = await Promise.all([
    db.select().from(afterSalesCases).where(and(gte(afterSalesCases.openedAt, range.from), lt(afterSalesCases.openedAt, range.to))),
    db
      .select({ productId: quoteItems.productId, quantity: quoteItems.quantity })
      .from(quoteItems)
      .innerJoin(quoteRooms, eq(quoteItems.quoteRoomId, quoteRooms.id))
      .innerJoin(quotes, eq(quoteRooms.quoteId, quotes.id))
      .where(eq(quotes.status, "approved")),
  ]);
  const sold = new Map<number, number>();
  for (const row of soldRows) if (row.productId) sold.set(row.productId, round((sold.get(row.productId) ?? 0) + toNumber(row.quantity)));
  return buildAfterSalesReport(cases.map((item) => ({ ...item, quantity: toNumber(item.quantity) })), sold, now);
}

// Para o Resumo do dia: em andamento com prazo até hoje.
export async function afterSalesDue(now = new Date()) {
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const rows = (await listAfterSalesCases({}, now)).filter((row) => row.active && row.dueDate < endOfDay);
  return rows.map((row) => ({ id: row.id, quoteNumber: row.quoteNumber, clientName: row.clientName, productDescription: row.productDescription, type: row.type, overdue: row.overdue }));
}
