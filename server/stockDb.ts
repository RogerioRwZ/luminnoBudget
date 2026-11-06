import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { loanedByProduct } from "./loansDb";
import { afterSalesCases, products, quoteItemCancellations, quoteItemDeliveries, quoteItemReservations, quoteItems, quoteRooms, quotes, stockMovements } from "../drizzle/schema";
import { calculateAvailableStock, calculatePendingDelivery, calculateRemainingReservation, calculateStockAfter, describeFulfillment, getStockDelta, isCentQuantity, StockMovementType } from "../shared/stock";
import { toNumber } from "../shared/quote";
import { getDb, LOCKED_READS, retryOnDeadlock } from "./db";

const money = (value: number) => value.toFixed(2);

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

export async function inventoryOverview() {
  const db = await database();
  const [allProductRows, movementRows, reservationRows, loaned] = await Promise.all([
    db.select().from(products).orderBy(products.shortDescription),
    db.select().from(stockMovements).orderBy(desc(stockMovements.occurredAt), desc(stockMovements.id)).limit(500),
    db.select().from(quoteItemReservations),
    loanedByProduct(),
  ]);
  const reservedByProduct = new Map<number, number>();
  reservationRows.forEach((reservation) => reservedByProduct.set(reservation.productId, (reservedByProduct.get(reservation.productId) ?? 0) + toNumber(reservation.reservedQuantity)));
  const productMap = new Map(allProductRows.map((product) => [product.id, product]));
  // Arquivado sem saldo não tem o que controlar: fica fora do saldo, da
  // reposição e da movimentação.
  const productRows = allProductRows.filter((product) => product.active || toNumber(product.stockQuantity) !== 0);
  const stockValue = productRows.reduce((sum, product) => sum + toNumber(product.stockQuantity) * toNumber(product.unitPrice), 0);
  const lowStock = productRows.filter((product) => product.active && toNumber(product.reorderPoint) > 0 && toNumber(product.stockQuantity) <= toNumber(product.reorderPoint));
  return {
    products: productRows.map((product) => { const stockQuantity = toNumber(product.stockQuantity); const reservedQuantity = reservedByProduct.get(product.id) ?? 0; return { ...product, stockQuantity, reservedQuantity, availableQuantity: calculateAvailableStock(stockQuantity, reservedQuantity), loanedQuantity: loaned.get(product.id) ?? 0, reorderPoint: toNumber(product.reorderPoint), unitPrice: toNumber(product.unitPrice), lowStock: product.active && toNumber(product.reorderPoint) > 0 && stockQuantity <= toNumber(product.reorderPoint) }; }),
    lowStock: lowStock.map((product) => ({ ...product, stockQuantity: toNumber(product.stockQuantity), reorderPoint: toNumber(product.reorderPoint) })),
    suppliers: Array.from(new Set(productRows.map((product) => product.supplierName).filter((supplier): supplier is string => Boolean(supplier)))).sort((first, second) => first.localeCompare(second, "pt-BR")),
    stockValue,
    movements: movementRows.map((movement) => ({ ...movement, quantity: toNumber(movement.quantity), beforeQuantity: toNumber(movement.beforeQuantity), afterQuantity: toNumber(movement.afterQuantity), product: productMap.get(movement.productId) ? { code: productMap.get(movement.productId)!.code, shortDescription: productMap.get(movement.productId)!.shortDescription, unit: productMap.get(movement.productId)!.unit } : null })),
  };
}

const HISTORY_LIMIT = 200;

// Histórico com busca: cada palavra precisa aparecer em algum campo. A
// comparação segue o banco, que ignora maiúsculas e acentos.
export async function searchMovements(input: { search?: string; type?: StockMovementType }) {
  const db = await database();
  const haystack = sql`CONCAT_WS(' ', ${products.reference}, ${products.code}, ${products.barcode}, ${products.shortDescription}, ${products.fullDescription}, ${products.supplierName}, ${stockMovements.clientName}, ${stockMovements.responsible}, ${stockMovements.notes}, CONCAT('#', ${quotes.quoteNumber}))`;
  const words = (input.search ?? "").split(/\s+/).filter(Boolean).slice(0, 8);
  const filters = [
    ...(input.type ? [eq(stockMovements.type, input.type)] : []),
    ...words.map((word) => sql`${haystack} LIKE ${`%${word.replace(/[\\%_]/g, "\\$&")}%`}`),
  ];
  const rows = await db
    .select({ movement: stockMovements, product: { code: products.code, reference: products.reference, shortDescription: products.shortDescription, unit: products.unit }, quoteNumber: quotes.quoteNumber })
    .from(stockMovements)
    .leftJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(quotes, eq(quotes.id, stockMovements.quoteId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.id))
    .limit(HISTORY_LIMIT + 1);
  return {
    limit: HISTORY_LIMIT,
    limited: rows.length > HISTORY_LIMIT,
    rows: rows.slice(0, HISTORY_LIMIT).map((row) => ({ ...row.movement, quantity: toNumber(row.movement.quantity), beforeQuantity: toNumber(row.movement.beforeQuantity), afterQuantity: toNumber(row.movement.afterQuantity), product: row.product, quoteNumber: row.quoteNumber })),
  };
}

export type StockMovementInput = { productId: number; type: Exclude<StockMovementType, "delivery">; quantity: number; responsible?: string | null; notes?: string | null; occurredAt: Date; quoteId?: number | null; quoteItemId?: number | null; clientName?: string | null };

// Dentro de uma transação já aberta: o pós-venda grava a ocorrência e a
// movimentação juntas.
export async function moveStock(tx: Tx, input: StockMovementInput) {
  // FOR UPDATE: sem a trava, duas movimentações simultâneas leem o mesmo
  // saldo "antes" e a segunda sobrescreve a primeira.
  await tx.execute(sql`SELECT id FROM ${products} WHERE ${eq(products.id, input.productId)} FOR UPDATE`);
  const product = (await tx.select().from(products).where(eq(products.id, input.productId)).limit(1))[0];
  if (!product) throw new Error("Produto não encontrado");
  const beforeQuantity = toNumber(product.stockQuantity);
  const afterQuantity = calculateStockAfter(beforeQuantity, input.type, input.quantity);
  // Saída que não é retirada de pedido (ajuste, empréstimo): não pode usar o
  // que já está reservado para orçamentos aprovados.
  if (afterQuantity < beforeQuantity) {
    const reservations = await tx.select({ reservedQuantity: quoteItemReservations.reservedQuantity }).from(quoteItemReservations).where(eq(quoteItemReservations.productId, product.id));
    const reserved = reservations.reduce((sum, row) => sum + toNumber(row.reservedQuantity), 0);
    if (afterQuantity < reserved) throw new Error(`${input.type === "loan_out" ? "O empréstimo" : "O ajuste"} deixaria o saldo (${afterQuantity}) abaixo da quantidade reservada para orçamentos aprovados (${reserved}).`);
  }
  await tx.update(products).set({ stockQuantity: money(afterQuantity) }).where(eq(products.id, product.id));
  const inserted = await tx.insert(stockMovements).values({ productId: product.id, type: input.type, quantity: money(getStockDelta(input.type, input.quantity)), beforeQuantity: money(beforeQuantity), afterQuantity: money(afterQuantity), responsible: input.responsible || null, notes: input.notes || null, occurredAt: input.occurredAt, quoteId: input.quoteId ?? null, quoteItemId: input.quoteItemId ?? null, clientName: input.clientName || null }).$returningId();
  // Mercadoria que chegou vai primeiro para os aprovados que esperavam por ela.
  if (afterQuantity > beforeQuantity) await allocatePendingReservations(tx, [product.id]);
  return { movementId: inserted[0]!.id, beforeQuantity, afterQuantity };
}

export async function recordStockMovement(input: StockMovementInput) {
  const db = await database();
  return db.transaction((tx) => moveStock(tx, input), LOCKED_READS);
}

// Reserva o estoque livre para itens de orçamentos aprovados que ainda estão
// sem reserva completa, na ordem de aprovação. Chamada ao aprovar, quando
// entra mercadoria e quando outro orçamento libera a reserva.
export async function allocatePendingReservations(tx: Tx, productIds: number[]) {
  const ids = Array.from(new Set(productIds)).sort((first, second) => first - second);
  if (!ids.length) return;
  await tx.execute(sql`SELECT id FROM ${products} WHERE ${inArray(products.id, ids)} FOR UPDATE`);
  const [productRows, reservations, lines] = await Promise.all([
    tx.select({ id: products.id, stockQuantity: products.stockQuantity }).from(products).where(inArray(products.id, ids)),
    tx.select().from(quoteItemReservations).where(inArray(quoteItemReservations.productId, ids)),
    tx.select({ itemId: quoteItems.id, productId: quoteItems.productId, quantity: quoteItems.quantity, quoteId: quotes.id })
      .from(quoteItems)
      .innerJoin(quoteRooms, eq(quoteRooms.id, quoteItems.quoteRoomId))
      .innerJoin(quotes, eq(quotes.id, quoteRooms.quoteId))
      .where(and(eq(quotes.status, "approved"), inArray(quoteItems.productId, ids)))
      .orderBy(asc(quotes.approvedAt), asc(quotes.id), asc(quoteRooms.sortOrder), asc(quoteItems.sortOrder), asc(quoteItems.id)),
  ]);
  if (!lines.length) return;
  const lineIds = lines.map((line) => line.itemId);
  const [deliveries, cancellations] = await Promise.all([
    tx.select({ quoteItemId: quoteItemDeliveries.quoteItemId, deliveredQuantity: quoteItemDeliveries.deliveredQuantity }).from(quoteItemDeliveries).where(and(inArray(quoteItemDeliveries.quoteItemId, lineIds), isNull(quoteItemDeliveries.reversedAt))),
    tx.select({ quoteItemId: quoteItemCancellations.quoteItemId, quantity: quoteItemCancellations.quantity }).from(quoteItemCancellations).where(and(inArray(quoteItemCancellations.quoteItemId, lineIds), isNull(quoteItemCancellations.undoneAt))),
  ]);
  const deliveredByItem = sumBy(deliveries, (row) => row.quoteItemId, (row) => toNumber(row.deliveredQuantity));
  const cancelledByItem = sumBy(cancellations, (row) => row.quoteItemId, (row) => toNumber(row.quantity));
  const reservationByItem = new Map(reservations.map((row) => [row.quoteItemId, row]));
  const reservedByProduct = sumBy(reservations, (row) => row.productId, (row) => toNumber(row.reservedQuantity));
  const free = new Map(productRows.map((row) => [row.id, calculateAvailableStock(toNumber(row.stockQuantity), reservedByProduct.get(row.id) ?? 0)]));
  for (const line of lines) {
    const productId = line.productId!;
    const reservation = reservationByItem.get(line.itemId);
    const reserved = reservation ? toNumber(reservation.reservedQuantity) : 0;
    const { shortage } = describeFulfillment({ ordered: toNumber(line.quantity), delivered: deliveredByItem.get(line.itemId) ?? 0, cancelled: cancelledByItem.get(line.itemId) ?? 0, reserved, stock: 0 });
    const take = round2(Math.min(shortage, free.get(productId) ?? 0));
    if (take <= 0) continue;
    free.set(productId, round2((free.get(productId) ?? 0) - take));
    if (reservation) await tx.update(quoteItemReservations).set({ reservedQuantity: money(reserved + take) }).where(eq(quoteItemReservations.id, reservation.id));
    else await tx.insert(quoteItemReservations).values({ quoteId: line.quoteId, quoteItemId: line.itemId, productId, reservedQuantity: money(take) });
  }
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
function sumBy<T>(rows: T[], key: (row: T) => number, value: (row: T) => number) {
  const totals = new Map<number, number>();
  rows.forEach((row) => totals.set(key(row), round2((totals.get(key(row)) ?? 0) + value(row))));
  return totals;
}

export type FulfillmentLine = Awaited<ReturnType<typeof fulfillmentLines>>[number];

// Situação de cada item dos orçamentos informados: pedido, retirado,
// reservado, o que dá para retirar agora e o que falta comprar.
export async function fulfillmentLines(quoteIds: number[]) {
  if (!quoteIds.length) return [];
  const db = await database();
  const [quoteRows, rooms] = await Promise.all([
    db.select().from(quotes).where(inArray(quotes.id, quoteIds)),
    db.select().from(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds)).orderBy(asc(quoteRooms.sortOrder), asc(quoteRooms.id)),
  ]);
  if (!rooms.length) return [];
  const items = await db.select().from(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id))).orderBy(asc(quoteItems.sortOrder), asc(quoteItems.id));
  if (!items.length) return [];
  const itemIds = items.map((item) => item.id);
  const productIds = Array.from(new Set(items.map((item) => item.productId).filter((id): id is number => Boolean(id))));
  const [deliveries, cancellations, reservations, productRows, productReservations] = await Promise.all([
    db.select().from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, itemIds)).orderBy(desc(quoteItemDeliveries.deliveredAt)),
    db.select().from(quoteItemCancellations).where(inArray(quoteItemCancellations.quoteItemId, itemIds)).orderBy(desc(quoteItemCancellations.cancelledAt)),
    db.select().from(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, itemIds)),
    productIds.length ? db.select().from(products).where(inArray(products.id, productIds)) : Promise.resolve([] as Array<typeof products.$inferSelect>),
    productIds.length ? db.select().from(quoteItemReservations).where(inArray(quoteItemReservations.productId, productIds)) : Promise.resolve([] as Array<typeof quoteItemReservations.$inferSelect>),
  ]);
  const quoteMap = new Map(quoteRows.map((quote) => [quote.id, quote]));
  const roomMap = new Map(rooms.map((room) => [room.id, room]));
  const productMap = new Map(productRows.map((product) => [product.id, product]));
  const reservedByProduct = sumBy(productReservations, (row) => row.productId, (row) => toNumber(row.reservedQuantity));
  const reservationByItem = new Map(reservations.map((row) => [row.quoteItemId, toNumber(row.reservedQuantity)]));
  const deliveriesByItem = new Map<number, typeof deliveries>();
  deliveries.forEach((row) => deliveriesByItem.set(row.quoteItemId, [...(deliveriesByItem.get(row.quoteItemId) ?? []), row]));
  const cancellationsByItem = new Map<number, typeof cancellations>();
  cancellations.forEach((row) => cancellationsByItem.set(row.quoteItemId, [...(cancellationsByItem.get(row.quoteItemId) ?? []), row]));
  return items.map((item) => {
    const room = roomMap.get(item.quoteRoomId)!;
    const quote = quoteMap.get(room.quoteId)!;
    const product = item.productId ? productMap.get(item.productId) : undefined;
    const itemDeliveries = deliveriesByItem.get(item.id) ?? [];
    const ordered = toNumber(item.quantity);
    const delivered = calculatePendingDelivery(ordered, itemDeliveries.filter((row) => !row.reversedAt).map((row) => toNumber(row.deliveredQuantity))).delivered;
    const itemCancellations = cancellationsByItem.get(item.id) ?? [];
    const cancelled = round2(itemCancellations.filter((row) => !row.undoneAt).reduce((sum, row) => sum + toNumber(row.quantity), 0));
    const reserved = reservationByItem.get(item.id) ?? 0;
    const stockQuantity = product ? toNumber(product.stockQuantity) : null;
    const status = describeFulfillment({ ordered, delivered, cancelled, reserved, stock: item.productId ? stockQuantity ?? 0 : null });
    const approved = quote.status === "approved";
    return {
      quoteId: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, phone: quote.phone, approved,
      quoteItemId: item.id, roomName: room.name, productId: item.productId, barcode: product?.barcode ?? null, reference: product?.reference ?? null,
      code: item.code, shortDescription: item.shortDescription, fullDescription: product?.fullDescription ?? null, unit: item.unit, unitPrice: toNumber(item.unitPrice), supplierName: product?.supplierName ?? null,
      orderedQuantity: ordered, deliveredQuantity: delivered, cancelledQuantity: cancelled, pendingQuantity: status.pending, reservedQuantity: reserved,
      deliverableQuantity: approved ? status.deliverable : 0, shortageQuantity: approved ? status.shortage : 0,
      stockQuantity, availableQuantity: product ? Math.max(0, calculateAvailableStock(stockQuantity ?? 0, reservedByProduct.get(product.id) ?? 0)) : null,
      deliveries: itemDeliveries.map((row) => ({ ...row, deliveredQuantity: toNumber(row.deliveredQuantity) })),
      cancellations: itemCancellations.map((row) => ({ ...row, quantity: toNumber(row.quantity) })),
    };
  });
}

export async function approvedFulfillments() {
  const db = await database();
  const approved = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.status, "approved")).orderBy(asc(quotes.approvedAt), asc(quotes.id));
  const order = new Map(approved.map((quote, index) => [quote.id, index]));
  const lines = await fulfillmentLines(approved.map((quote) => quote.id));
  return lines.sort((first, second) => Number(second.pendingQuantity > 0) - Number(first.pendingQuantity > 0) || order.get(first.quoteId)! - order.get(second.quoteId)!);
}

async function cancelledQuantity(tx: Tx, quoteItemId: number) {
  const rows = await tx.select({ quantity: quoteItemCancellations.quantity }).from(quoteItemCancellations).where(and(eq(quoteItemCancellations.quoteItemId, quoteItemId), isNull(quoteItemCancellations.undoneAt)));
  return round2(rows.reduce((sum, row) => sum + toNumber(row.quantity), 0));
}

type DeliveryMeta = { responsible?: string | null; notes?: string | null; deliveredAt: Date };

// Registra retiradas de vários itens do mesmo orçamento numa transação só:
// ou tudo entra, ou nada muda.
async function deliverInTransaction(tx: Tx, quoteId: number, requested: Array<{ quoteItemId: number; quantity: number }>, meta: DeliveryMeta) {
  // Primeira coisa: trava o orçamento. É o que segura duas retiradas do mesmo
  // pedido ao mesmo tempo, inclusive de item avulso, que não trava produto.
  await tx.execute(sql`SELECT id FROM ${quotes} WHERE ${eq(quotes.id, quoteId)} FOR UPDATE`);
  const quote = (await tx.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0];
  if (!quote) throw new Error("Orçamento não encontrado");
  if (quote.status !== "approved") throw new Error("A retirada só pode ser registrada em orçamentos aprovados");
  const merged = new Map<number, number>();
  requested.forEach((line) => {
    if (!(line.quantity > 0) || !isCentQuantity(line.quantity)) throw new Error("Informe quantidades maiores que zero, com até 2 casas decimais.");
    merged.set(line.quoteItemId, round2((merged.get(line.quoteItemId) ?? 0) + line.quantity));
  });
  if (!merged.size) throw new Error("Nenhum item para retirar.");
  const items = await tx.select({ item: quoteItems, room: quoteRooms }).from(quoteItems).innerJoin(quoteRooms, eq(quoteRooms.id, quoteItems.quoteRoomId)).where(inArray(quoteItems.id, Array.from(merged.keys())));
  if (items.length !== merged.size || items.some((row) => row.room.quoteId !== quote.id)) throw new Error("O item não pertence ao orçamento informado");
  const productIds = Array.from(new Set(items.map((row) => row.item.productId).filter((id): id is number => Boolean(id)))).sort((first, second) => first - second);
  if (productIds.length) await tx.execute(sql`SELECT id FROM ${products} WHERE ${inArray(products.id, productIds)} FOR UPDATE`);
  const results: Array<{ deliveryId: number; quoteItemId: number; deliveredQuantity: number; pendingQuantity: number; stockQuantity: number | null }> = [];
  for (const { item } of items) {
    const quantity = merged.get(item.id)!;
    const priorDeliveries = await tx.select().from(quoteItemDeliveries).where(and(eq(quoteItemDeliveries.quoteItemId, item.id), isNull(quoteItemDeliveries.reversedAt)));
    const cancelled = await cancelledQuantity(tx, item.id);
    const delivery = calculatePendingDelivery(round2(toNumber(item.quantity) - cancelled), priorDeliveries.map((row) => toNumber(row.deliveredQuantity)));
    if (quantity > delivery.pending) throw new Error(`A retirada de "${item.shortDescription}" excede o saldo pendente de ${delivery.pending} ${item.unit}`);
    const base = { quoteId: quote.id, quoteItemId: item.id, clientName: quote.clientName || null, deliveredQuantity: money(quantity), deliveredAt: meta.deliveredAt, responsible: meta.responsible || null, notes: meta.notes || null };
    if (!item.productId) {
      const inserted = await tx.insert(quoteItemDeliveries).values({ ...base, productId: null, stockMovementId: null }).$returningId();
      results.push({ deliveryId: inserted[0]!.id, quoteItemId: item.id, deliveredQuantity: quantity, pendingQuantity: round2(delivery.pending - quantity), stockQuantity: null });
      continue;
    }
    const product = (await tx.select().from(products).where(eq(products.id, item.productId)).limit(1))[0];
    if (!product) throw new Error("Produto não encontrado no estoque");
    const reservation = (await tx.select().from(quoteItemReservations).where(eq(quoteItemReservations.quoteItemId, item.id)).limit(1))[0];
    const reserved = reservation ? toNumber(reservation.reservedQuantity) : 0;
    if (!reservation || quantity > reserved) throw new Error(`Só ${reserved} ${item.unit} de "${item.shortDescription}" estão reservados para este orçamento. Registre a entrada da mercadoria no estoque para liberar o restante.`);
    const beforeQuantity = toNumber(product.stockQuantity);
    const afterQuantity = calculateStockAfter(beforeQuantity, "delivery", quantity);
    await tx.update(products).set({ stockQuantity: money(afterQuantity) }).where(eq(products.id, product.id));
    const movement = await tx.insert(stockMovements).values({ productId: product.id, type: "delivery", quantity: money(getStockDelta("delivery", quantity)), beforeQuantity: money(beforeQuantity), afterQuantity: money(afterQuantity), quoteId: quote.id, quoteItemId: item.id, clientName: quote.clientName || null, responsible: meta.responsible || null, notes: meta.notes || null, occurredAt: meta.deliveredAt }).$returningId();
    const inserted = await tx.insert(quoteItemDeliveries).values({ ...base, productId: product.id, stockMovementId: movement[0]!.id }).$returningId();
    const remainingReservation = calculateRemainingReservation(reserved, quantity);
    if (remainingReservation <= 0) await tx.delete(quoteItemReservations).where(eq(quoteItemReservations.id, reservation.id));
    else await tx.update(quoteItemReservations).set({ reservedQuantity: money(remainingReservation) }).where(eq(quoteItemReservations.id, reservation.id));
    results.push({ deliveryId: inserted[0]!.id, quoteItemId: item.id, deliveredQuantity: quantity, pendingQuantity: round2(delivery.pending - quantity), stockQuantity: afterQuantity });
  }
  return results;
}

export async function deliverQuoteItem(input: { quoteId: number; quoteItemId: number; quantity: number } & DeliveryMeta) {
  const db = await database();
  const [result] = await retryOnDeadlock(() => db.transaction((tx) => deliverInTransaction(tx, input.quoteId, [{ quoteItemId: input.quoteItemId, quantity: input.quantity }], input), LOCKED_READS));
  return result!;
}

export async function deliverQuoteItems(input: { quoteId: number; lines: Array<{ quoteItemId: number; quantity: number }> } & DeliveryMeta) {
  const db = await database();
  return retryOnDeadlock(() => db.transaction((tx) => deliverInTransaction(tx, input.quoteId, input.lines, input), LOCKED_READS));
}

// "Retirar tudo": tudo o que está reservado (e os itens avulsos pendentes).
export async function deliverAllAvailable(input: { quoteId: number } & DeliveryMeta) {
  const lines = (await fulfillmentLines([input.quoteId])).filter((line) => line.deliverableQuantity > 0).map((line) => ({ quoteItemId: line.quoteItemId, quantity: line.deliverableQuantity }));
  if (!lines.length) throw new Error("Não há itens disponíveis para retirada neste orçamento. Confira as reservas no estoque.");
  return deliverQuoteItems({ ...input, lines });
}

// Cancela o que o cliente não vai mais retirar: o saldo sai de Retiradas,
// Separação e Compras, e a reserva liberada vai para quem está na fila. O
// Financeiro não muda: o dinheiro pode já ter sido recebido.
export async function cancelRemainder(input: { quoteId: number; lines: Array<{ quoteItemId: number; quantity: number }>; reason: string }, userId: number) {
  const db = await database();
  return retryOnDeadlock(() => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${quotes} WHERE ${eq(quotes.id, input.quoteId)} FOR UPDATE`);
    const quote = (await tx.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1))[0];
    if (!quote) throw new Error("Orçamento não encontrado");
    if (quote.status !== "approved") throw new Error("Só dá para cancelar saldo de orçamentos aprovados.");
    const merged = new Map<number, number>();
    input.lines.forEach((line) => {
      if (!(line.quantity > 0) || !isCentQuantity(line.quantity)) throw new Error("Informe quantidades maiores que zero, com até 2 casas decimais.");
      merged.set(line.quoteItemId, round2((merged.get(line.quoteItemId) ?? 0) + line.quantity));
    });
    if (!merged.size) throw new Error("Nenhum item para cancelar.");
    const items = await tx.select({ item: quoteItems, room: quoteRooms }).from(quoteItems).innerJoin(quoteRooms, eq(quoteRooms.id, quoteItems.quoteRoomId)).where(inArray(quoteItems.id, Array.from(merged.keys())));
    if (items.length !== merged.size || items.some((row) => row.room.quoteId !== quote.id)) throw new Error("O item não pertence ao orçamento informado");
    const productIds = Array.from(new Set(items.map((row) => row.item.productId).filter((id): id is number => Boolean(id)))).sort((first, second) => first - second);
    if (productIds.length) await tx.execute(sql`SELECT id FROM ${products} WHERE ${inArray(products.id, productIds)} FOR UPDATE`);
    let amount = 0;
    for (const { item } of items) {
      const quantity = merged.get(item.id)!;
      const delivered = await tx.select({ quantity: quoteItemDeliveries.deliveredQuantity }).from(quoteItemDeliveries).where(and(eq(quoteItemDeliveries.quoteItemId, item.id), isNull(quoteItemDeliveries.reversedAt)));
      const { pending } = calculatePendingDelivery(round2(toNumber(item.quantity) - await cancelledQuantity(tx, item.id)), delivered.map((row) => toNumber(row.quantity)));
      if (quantity > pending) throw new Error(`O cancelamento de "${item.shortDescription}" excede o saldo pendente de ${pending} ${item.unit}`);
      await tx.insert(quoteItemCancellations).values({ quoteId: quote.id, quoteItemId: item.id, productId: item.productId, quantity: money(quantity), reason: input.reason, createdByUserId: userId });
      amount = round2(amount + quantity * toNumber(item.unitPrice));
      const reservation = (await tx.select().from(quoteItemReservations).where(eq(quoteItemReservations.quoteItemId, item.id)).limit(1))[0];
      const left = round2(pending - quantity);
      if (reservation && toNumber(reservation.reservedQuantity) > left) {
        if (left <= 0) await tx.delete(quoteItemReservations).where(eq(quoteItemReservations.id, reservation.id));
        else await tx.update(quoteItemReservations).set({ reservedQuantity: money(left) }).where(eq(quoteItemReservations.id, reservation.id));
      }
    }
    await allocatePendingReservations(tx, productIds);
    return { quoteNumber: quote.quoteNumber, clientName: quote.clientName, amount };
  }, LOCKED_READS));
}

// Desfazer o cancelamento: o item volta a pendente e reserva o que houver livre.
export async function undoCancellation(id: number, userId: number) {
  const db = await database();
  return retryOnDeadlock(() => db.transaction(async (tx) => {
    const found = (await tx.select({ quoteId: quoteItemCancellations.quoteId }).from(quoteItemCancellations).where(eq(quoteItemCancellations.id, id)).limit(1))[0];
    if (!found) throw new Error("Cancelamento não encontrado.");
    await tx.execute(sql`SELECT id FROM ${quotes} WHERE ${eq(quotes.id, found.quoteId)} FOR UPDATE`);
    const row = (await tx.select().from(quoteItemCancellations).where(eq(quoteItemCancellations.id, id)).limit(1))[0]!;
    if (row.undoneAt) throw new Error("Este cancelamento já foi desfeito.");
    const quote = (await tx.select().from(quotes).where(eq(quotes.id, row.quoteId)).limit(1))[0]!;
    if (quote.status !== "approved") throw new Error("Este orçamento não está mais aprovado.");
    await tx.update(quoteItemCancellations).set({ undoneAt: new Date(), undoneByUserId: userId }).where(eq(quoteItemCancellations.id, id));
    if (row.productId) await allocatePendingReservations(tx, [row.productId]);
    return { quoteNumber: quote.quoteNumber, clientName: quote.clientName, quantity: toNumber(row.quantity) };
  }, LOCKED_READS));
}

// Estorna a retirada lançada por engano: a peça volta ao estoque, o item volta
// a pendente e a reserva é refeita pela ordem de aprovação. O registro fica.
export async function reverseDelivery(input: { deliveryId: number; reason: string; responsible?: string | null }, userId: number) {
  const db = await database();
  return retryOnDeadlock(() => db.transaction(async (tx) => {
    const found = (await tx.select({ quoteId: quoteItemDeliveries.quoteId }).from(quoteItemDeliveries).where(eq(quoteItemDeliveries.id, input.deliveryId)).limit(1))[0];
    if (!found) throw new Error("Retirada não encontrada.");
    await tx.execute(sql`SELECT id FROM ${quotes} WHERE ${eq(quotes.id, found.quoteId)} FOR UPDATE`);
    const delivery = (await tx.select().from(quoteItemDeliveries).where(eq(quoteItemDeliveries.id, input.deliveryId)).limit(1))[0]!;
    if (delivery.reversedAt) throw new Error("Esta retirada já foi estornada.");
    const quote = (await tx.select().from(quotes).where(eq(quotes.id, delivery.quoteId)).limit(1))[0]!;
    if (quote.status !== "approved") throw new Error("Este orçamento não está mais aprovado.");
    const quantity = toNumber(delivery.deliveredQuantity);
    // O que está em ocorrência de pós-venda já saiu para o cliente de fato.
    const [active, cases] = await Promise.all([
      tx.select({ quantity: quoteItemDeliveries.deliveredQuantity }).from(quoteItemDeliveries).where(and(eq(quoteItemDeliveries.quoteItemId, delivery.quoteItemId), isNull(quoteItemDeliveries.reversedAt))),
      tx.select({ quantity: afterSalesCases.quantity, status: afterSalesCases.status }).from(afterSalesCases).where(eq(afterSalesCases.quoteItemId, delivery.quoteItemId)),
    ]);
    const delivered = active.reduce((sum, row) => sum + toNumber(row.quantity), 0);
    const inCases = cases.filter((row) => row.status !== "rejected").reduce((sum, row) => sum + toNumber(row.quantity), 0);
    if (round2(delivered - quantity) < round2(inCases)) throw new Error(`Não dá para estornar: ${inCases} deste item estão em ocorrências de pós-venda. Recuse ou resolva a ocorrência pelo Pós-venda.`);
    // Marca antes de devolver ao estoque: a reserva refeita pela entrada já
    // precisa enxergar o item como pendente.
    await tx.update(quoteItemDeliveries).set({ reversedAt: new Date(), reversalReason: input.reason, reversedByUserId: userId }).where(eq(quoteItemDeliveries.id, delivery.id));
    if (delivery.productId) {
      const moved = await moveStock(tx, { productId: delivery.productId, type: "return", quantity, occurredAt: new Date(), responsible: input.responsible || null, notes: `Estorno da retirada #${delivery.id}: ${input.reason}`, quoteId: quote.id, quoteItemId: delivery.quoteItemId, clientName: quote.clientName || null });
      await tx.update(quoteItemDeliveries).set({ reversalMovementId: moved.movementId }).where(eq(quoteItemDeliveries.id, delivery.id));
    }
    return { quoteNumber: quote.quoteNumber, clientName: quote.clientName, quantity };
  }, LOCKED_READS));
}

export type PurchaseLine = {
  productId: number; code: string; reference: string | null; barcode: string | null; shortDescription: string; unit: string;
  stockQuantity: number; reservedQuantity: number; freeQuantity: number; reorderPoint: number;
  shortageQuantity: number; reorderQuantity: number; openDemandQuantity: number; openGapQuantity: number;
  waitingQuotes: Array<{ quoteId: number; quoteNumber: number; clientName: string; quantity: number }>;
};

// O que comprar, por fornecedor: a falta dos aprovados (já vendido e sem
// estoque), a reposição até o ponto de pedido e, à parte, o que os
// orçamentos em negociação pediriam além do estoque livre.
export async function purchaseSuggestions() {
  const db = await database();
  const [productRows, reservations, approved, openQuotes] = await Promise.all([
    db.select().from(products),
    db.select().from(quoteItemReservations),
    approvedFulfillments(),
    db.select({ productId: quoteItems.productId, quantity: quoteItems.quantity }).from(quoteItems).innerJoin(quoteRooms, eq(quoteRooms.id, quoteItems.quoteRoomId)).innerJoin(quotes, eq(quotes.id, quoteRooms.quoteId)).where(eq(quotes.status, "open")),
  ]);
  const reservedByProduct = sumBy(reservations, (row) => row.productId, (row) => toNumber(row.reservedQuantity));
  const openByProduct = sumBy(openQuotes.filter((row) => row.productId), (row) => row.productId!, (row) => toNumber(row.quantity));
  const waiting = new Map<number, PurchaseLine["waitingQuotes"]>();
  approved.filter((line) => line.productId && line.shortageQuantity > 0).forEach((line) => {
    const list = waiting.get(line.productId!) ?? [];
    const existing = list.find((entry) => entry.quoteId === line.quoteId);
    if (existing) existing.quantity = round2(existing.quantity + line.shortageQuantity);
    else list.push({ quoteId: line.quoteId, quoteNumber: line.quoteNumber, clientName: line.clientName, quantity: line.shortageQuantity });
    waiting.set(line.productId!, list);
  });
  const suppliers = new Map<string, PurchaseLine[]>();
  for (const product of productRows) {
    const stockQuantity = toNumber(product.stockQuantity);
    const reservedQuantity = reservedByProduct.get(product.id) ?? 0;
    const freeQuantity = Math.max(0, calculateAvailableStock(stockQuantity, reservedQuantity));
    const reorderPoint = toNumber(product.reorderPoint);
    const waitingQuotes = waiting.get(product.id) ?? [];
    const shortageQuantity = round2(waitingQuotes.reduce((sum, entry) => sum + entry.quantity, 0));
    const reorderQuantity = product.active && reorderPoint > 0 ? Math.max(0, round2(reorderPoint - freeQuantity)) : 0;
    const openDemandQuantity = openByProduct.get(product.id) ?? 0;
    const openGapQuantity = Math.max(0, round2(openDemandQuantity - freeQuantity));
    if (shortageQuantity <= 0 && reorderQuantity <= 0 && openGapQuantity <= 0) continue;
    const supplier = product.supplierName?.trim() || "";
    suppliers.set(supplier, [...(suppliers.get(supplier) ?? []), { productId: product.id, code: product.code, reference: product.reference, barcode: product.barcode, shortDescription: product.shortDescription, unit: product.unit, stockQuantity, reservedQuantity, freeQuantity, reorderPoint, shortageQuantity, reorderQuantity, openDemandQuantity, openGapQuantity, waitingQuotes }]);
  }
  return Array.from(suppliers.entries())
    .map(([supplierName, lines]) => ({ supplierName, lines: lines.sort((first, second) => second.shortageQuantity - first.shortageQuantity || first.shortDescription.localeCompare(second.shortDescription, "pt-BR")) }))
    .sort((first, second) => (first.supplierName ? 0 : 1) - (second.supplierName ? 0 : 1) || first.supplierName.localeCompare(second.supplierName, "pt-BR"));
}

// Saldo livre (estoque menos reservas) de cada produto ativo: usado pelo
// orçamento para avisar falta.
export async function productAvailability() {
  const db = await database();
  const [productRows, reservations] = await Promise.all([
    db.select({ id: products.id, stockQuantity: products.stockQuantity }).from(products).where(eq(products.active, true)),
    db.select({ productId: quoteItemReservations.productId, reservedQuantity: quoteItemReservations.reservedQuantity }).from(quoteItemReservations),
  ]);
  const reserved = sumBy(reservations, (row) => row.productId, (row) => toNumber(row.reservedQuantity));
  return productRows.map((product) => ({ productId: product.id, available: Math.max(0, calculateAvailableStock(toNumber(product.stockQuantity), reserved.get(product.id) ?? 0)) }));
}
