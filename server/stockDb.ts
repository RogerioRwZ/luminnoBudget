import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { products, quoteItemDeliveries, quoteItemReservations, quoteItems, quoteRooms, quotes, stockMovements } from "../drizzle/schema";
import { calculateAvailableStock, calculatePendingDelivery, calculateRemainingReservation, calculateStockAfter, describeFulfillment, getStockDelta, isCentQuantity, StockMovementType } from "../shared/stock";
import { toNumber } from "../shared/quote";
import { getDb } from "./db";

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
  const [productRows, movementRows, reservationRows] = await Promise.all([
    db.select().from(products).orderBy(products.shortDescription),
    db.select().from(stockMovements).orderBy(desc(stockMovements.occurredAt), desc(stockMovements.id)).limit(100),
    db.select().from(quoteItemReservations),
  ]);
  const reservedByProduct = new Map<number, number>();
  reservationRows.forEach((reservation) => reservedByProduct.set(reservation.productId, (reservedByProduct.get(reservation.productId) ?? 0) + toNumber(reservation.reservedQuantity)));
  const productMap = new Map(productRows.map((product) => [product.id, product]));
  const stockValue = productRows.reduce((sum, product) => sum + toNumber(product.stockQuantity) * toNumber(product.unitPrice), 0);
  const lowStock = productRows.filter((product) => toNumber(product.reorderPoint) > 0 && toNumber(product.stockQuantity) <= toNumber(product.reorderPoint));
  return {
    products: productRows.map((product) => { const stockQuantity = toNumber(product.stockQuantity); const reservedQuantity = reservedByProduct.get(product.id) ?? 0; return { ...product, stockQuantity, reservedQuantity, availableQuantity: calculateAvailableStock(stockQuantity, reservedQuantity), reorderPoint: toNumber(product.reorderPoint), unitPrice: toNumber(product.unitPrice), lowStock: toNumber(product.reorderPoint) > 0 && stockQuantity <= toNumber(product.reorderPoint) }; }),
    lowStock: lowStock.map((product) => ({ ...product, stockQuantity: toNumber(product.stockQuantity), reorderPoint: toNumber(product.reorderPoint) })),
    suppliers: Array.from(new Set(productRows.map((product) => product.supplierName).filter((supplier): supplier is string => Boolean(supplier)))).sort((first, second) => first.localeCompare(second, "pt-BR")),
    stockValue,
    movements: movementRows.map((movement) => ({ ...movement, quantity: toNumber(movement.quantity), beforeQuantity: toNumber(movement.beforeQuantity), afterQuantity: toNumber(movement.afterQuantity), product: productMap.get(movement.productId) ? { code: productMap.get(movement.productId)!.code, shortDescription: productMap.get(movement.productId)!.shortDescription, unit: productMap.get(movement.productId)!.unit } : null })),
  };
}

export async function recordStockMovement(input: { productId: number; type: Exclude<StockMovementType, "delivery">; quantity: number; responsible?: string | null; notes?: string | null; occurredAt: Date }) {
  const db = await database();
  return db.transaction(async (tx) => {
    // FOR UPDATE: sem a trava, duas movimentações simultâneas leem o mesmo
    // saldo "antes" e a segunda sobrescreve a primeira.
    await tx.execute(sql`SELECT id FROM ${products} WHERE ${eq(products.id, input.productId)} FOR UPDATE`);
    const product = (await tx.select().from(products).where(eq(products.id, input.productId)).limit(1))[0];
    if (!product) throw new Error("Produto não encontrado");
    const beforeQuantity = toNumber(product.stockQuantity);
    const afterQuantity = calculateStockAfter(beforeQuantity, input.type, input.quantity);
    if (input.type === "adjustment" && afterQuantity < beforeQuantity) {
      const reservations = await tx.select({ reservedQuantity: quoteItemReservations.reservedQuantity }).from(quoteItemReservations).where(eq(quoteItemReservations.productId, product.id));
      const reserved = reservations.reduce((sum, row) => sum + toNumber(row.reservedQuantity), 0);
      if (afterQuantity < reserved) throw new Error(`O ajuste deixaria o saldo (${afterQuantity}) abaixo da quantidade reservada para orçamentos aprovados (${reserved}).`);
    }
    await tx.update(products).set({ stockQuantity: money(afterQuantity) }).where(eq(products.id, product.id));
    const inserted = await tx.insert(stockMovements).values({ productId: product.id, type: input.type, quantity: money(getStockDelta(input.type, input.quantity)), beforeQuantity: money(beforeQuantity), afterQuantity: money(afterQuantity), responsible: input.responsible || null, notes: input.notes || null, occurredAt: input.occurredAt }).$returningId();
    // Mercadoria que chegou vai primeiro para os aprovados que esperavam por ela.
    if (afterQuantity > beforeQuantity) await allocatePendingReservations(tx, [product.id]);
    return { movementId: inserted[0]!.id, beforeQuantity, afterQuantity };
  });
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
  const deliveries = await tx.select({ quoteItemId: quoteItemDeliveries.quoteItemId, deliveredQuantity: quoteItemDeliveries.deliveredQuantity }).from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, lines.map((line) => line.itemId)));
  const deliveredByItem = sumBy(deliveries, (row) => row.quoteItemId, (row) => toNumber(row.deliveredQuantity));
  const reservationByItem = new Map(reservations.map((row) => [row.quoteItemId, row]));
  const reservedByProduct = sumBy(reservations, (row) => row.productId, (row) => toNumber(row.reservedQuantity));
  const free = new Map(productRows.map((row) => [row.id, calculateAvailableStock(toNumber(row.stockQuantity), reservedByProduct.get(row.id) ?? 0)]));
  for (const line of lines) {
    const productId = line.productId!;
    const reservation = reservationByItem.get(line.itemId);
    const reserved = reservation ? toNumber(reservation.reservedQuantity) : 0;
    const { shortage } = describeFulfillment({ ordered: toNumber(line.quantity), delivered: deliveredByItem.get(line.itemId) ?? 0, reserved, stock: 0 });
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
  const [deliveries, reservations, productRows, productReservations] = await Promise.all([
    db.select().from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, itemIds)).orderBy(desc(quoteItemDeliveries.deliveredAt)),
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
  return items.map((item) => {
    const room = roomMap.get(item.quoteRoomId)!;
    const quote = quoteMap.get(room.quoteId)!;
    const product = item.productId ? productMap.get(item.productId) : undefined;
    const itemDeliveries = deliveriesByItem.get(item.id) ?? [];
    const ordered = toNumber(item.quantity);
    const delivered = calculatePendingDelivery(ordered, itemDeliveries.map((row) => toNumber(row.deliveredQuantity))).delivered;
    const reserved = reservationByItem.get(item.id) ?? 0;
    const stockQuantity = product ? toNumber(product.stockQuantity) : null;
    const status = describeFulfillment({ ordered, delivered, reserved, stock: item.productId ? stockQuantity ?? 0 : null });
    const approved = quote.status === "approved";
    return {
      quoteId: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, phone: quote.phone, approved,
      quoteItemId: item.id, roomName: room.name, productId: item.productId, barcode: product?.barcode ?? null,
      code: item.code, shortDescription: item.shortDescription, fullDescription: product?.fullDescription ?? null, unit: item.unit, supplierName: product?.supplierName ?? null,
      orderedQuantity: ordered, deliveredQuantity: delivered, pendingQuantity: status.pending, reservedQuantity: reserved,
      deliverableQuantity: approved ? status.deliverable : 0, shortageQuantity: approved ? status.shortage : 0,
      stockQuantity, availableQuantity: product ? Math.max(0, calculateAvailableStock(stockQuantity ?? 0, reservedByProduct.get(product.id) ?? 0)) : null,
      deliveries: itemDeliveries.map((row) => ({ ...row, deliveredQuantity: toNumber(row.deliveredQuantity) })),
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

type DeliveryMeta = { responsible?: string | null; notes?: string | null; deliveredAt: Date };

// Registra retiradas de vários itens do mesmo orçamento numa transação só:
// ou tudo entra, ou nada muda.
async function deliverInTransaction(tx: Tx, quoteId: number, requested: Array<{ quoteItemId: number; quantity: number }>, meta: DeliveryMeta) {
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
    const priorDeliveries = await tx.select().from(quoteItemDeliveries).where(eq(quoteItemDeliveries.quoteItemId, item.id));
    const delivery = calculatePendingDelivery(toNumber(item.quantity), priorDeliveries.map((row) => toNumber(row.deliveredQuantity)));
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
  const [result] = await db.transaction((tx) => deliverInTransaction(tx, input.quoteId, [{ quoteItemId: input.quoteItemId, quantity: input.quantity }], input));
  return result!;
}

export async function deliverQuoteItems(input: { quoteId: number; lines: Array<{ quoteItemId: number; quantity: number }> } & DeliveryMeta) {
  const db = await database();
  return db.transaction((tx) => deliverInTransaction(tx, input.quoteId, input.lines, input));
}

// "Retirar tudo": tudo o que está reservado (e os itens avulsos pendentes).
export async function deliverAllAvailable(input: { quoteId: number } & DeliveryMeta) {
  const lines = (await fulfillmentLines([input.quoteId])).filter((line) => line.deliverableQuantity > 0).map((line) => ({ quoteItemId: line.quoteItemId, quantity: line.deliverableQuantity }));
  if (!lines.length) throw new Error("Não há itens disponíveis para retirada neste orçamento. Confira as reservas no estoque.");
  return deliverQuoteItems({ ...input, lines });
}
