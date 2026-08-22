import { desc, eq, inArray } from "drizzle-orm";
import { products, quoteItemDeliveries, quoteItemReservations, quoteItems, quoteRooms, quotes, stockMovements } from "../drizzle/schema";
import { calculateAvailableStock, calculatePendingDelivery, calculateRemainingReservation, calculateStockAfter, getStockDelta, StockMovementType } from "../shared/stock";
import { toNumber } from "../shared/quote";
import { getDb } from "./db";

const money = (value: number) => value.toFixed(2);

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
    const product = (await tx.select().from(products).where(eq(products.id, input.productId)).limit(1))[0];
    if (!product) throw new Error("Produto não encontrado");
    const beforeQuantity = toNumber(product.stockQuantity);
    const afterQuantity = calculateStockAfter(beforeQuantity, input.type, input.quantity);
    await tx.update(products).set({ stockQuantity: money(afterQuantity) }).where(eq(products.id, product.id));
    const inserted = await tx.insert(stockMovements).values({ productId: product.id, type: input.type, quantity: money(getStockDelta(input.type, input.quantity)), beforeQuantity: money(beforeQuantity), afterQuantity: money(afterQuantity), responsible: input.responsible || null, notes: input.notes || null, occurredAt: input.occurredAt }).$returningId();
    return { movementId: inserted[0]!.id, beforeQuantity, afterQuantity };
  });
}

export async function approvedFulfillments() {
  const db = await database();
  const [approvedQuotes, rooms, items, deliveries, reservations, productRows] = await Promise.all([
    db.select().from(quotes).where(eq(quotes.status, "approved")).orderBy(desc(quotes.updatedAt)),
    db.select().from(quoteRooms),
    db.select().from(quoteItems),
    db.select().from(quoteItemDeliveries).orderBy(desc(quoteItemDeliveries.deliveredAt)),
    db.select().from(quoteItemReservations),
    db.select().from(products),
  ]);
  const approvedIds = new Set(approvedQuotes.map((quote) => quote.id));
  const roomMap = new Map(rooms.filter((room) => approvedIds.has(room.quoteId)).map((room) => [room.id, room]));
  const productMap = new Map(productRows.map((product) => [product.id, product]));
  const deliveryByItem = new Map<number, typeof deliveries>();
  deliveries.forEach((delivery) => { const current = deliveryByItem.get(delivery.quoteItemId) ?? []; current.push(delivery); deliveryByItem.set(delivery.quoteItemId, current); });
  const reservationByItem = new Map(reservations.map((reservation) => [reservation.quoteItemId, reservation]));
  const reservedByProduct = new Map<number, number>();
  reservations.forEach((reservation) => reservedByProduct.set(reservation.productId, (reservedByProduct.get(reservation.productId) ?? 0) + toNumber(reservation.reservedQuantity)));
  const lines = items.filter((item) => roomMap.has(item.quoteRoomId) && item.productId).map((item) => {
    const room = roomMap.get(item.quoteRoomId)!; const quote = approvedQuotes.find((candidate) => candidate.id === room.quoteId)!; const itemDeliveries = deliveryByItem.get(item.id) ?? []; const delivery = calculatePendingDelivery(toNumber(item.quantity), itemDeliveries.map((row) => toNumber(row.deliveredQuantity))); const product = productMap.get(item.productId!);
    const stockQuantity = product ? toNumber(product.stockQuantity) : 0; const reservedQuantity = toNumber(reservationByItem.get(item.id)?.reservedQuantity ?? 0);
    return { quoteId: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, phone: quote.phone, quoteItemId: item.id, roomName: room.name, productId: item.productId!, code: item.code, shortDescription: item.shortDescription, unit: item.unit, orderedQuantity: toNumber(item.quantity), deliveredQuantity: delivery.delivered, pendingQuantity: delivery.pending, reservedQuantity, stockQuantity, availableQuantity: calculateAvailableStock(stockQuantity, reservedByProduct.get(item.productId!) ?? 0), deliveries: itemDeliveries.map((row) => ({ ...row, deliveredQuantity: toNumber(row.deliveredQuantity) })) };
  });
  return lines.sort((first, second) => Number(second.pendingQuantity > 0) - Number(first.pendingQuantity > 0) || first.quoteNumber - second.quoteNumber);
}

export async function deliverQuoteItem(input: { quoteId: number; quoteItemId: number; quantity: number; responsible?: string | null; notes?: string | null; deliveredAt: Date }) {
  const db = await database();
  return db.transaction(async (tx) => {
    const quote = (await tx.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1))[0];
    if (!quote) throw new Error("Orçamento não encontrado");
    if (quote.status !== "approved") throw new Error("A retirada só pode ser registrada em orçamentos aprovados");
    const item = (await tx.select().from(quoteItems).where(eq(quoteItems.id, input.quoteItemId)).limit(1))[0];
    if (!item || !item.productId) throw new Error("Este item não está vinculado a um produto de estoque");
    const room = (await tx.select().from(quoteRooms).where(eq(quoteRooms.id, item.quoteRoomId)).limit(1))[0];
    if (!room || room.quoteId !== quote.id) throw new Error("O item não pertence ao orçamento informado");
    const product = (await tx.select().from(products).where(eq(products.id, item.productId!)).limit(1))[0];
    if (!product) throw new Error("Produto não encontrado no estoque");
    const priorDeliveries = await tx.select().from(quoteItemDeliveries).where(eq(quoteItemDeliveries.quoteItemId, item.id));
    const delivery = calculatePendingDelivery(toNumber(item.quantity), priorDeliveries.map((row) => toNumber(row.deliveredQuantity)));
    if (input.quantity > delivery.pending) throw new Error(`A entrega excede o saldo pendente de ${delivery.pending} ${item.unit}`);
    const reservation = (await tx.select().from(quoteItemReservations).where(eq(quoteItemReservations.quoteItemId, item.id)).limit(1))[0];
    if (!reservation) throw new Error("Não existe reserva ativa para este item. Reaprove o orçamento para gerar a reserva.");
    if (input.quantity > toNumber(reservation.reservedQuantity)) throw new Error("A entrega excede a quantidade reservada para este item");
    const beforeQuantity = toNumber(product.stockQuantity);
    const afterQuantity = calculateStockAfter(beforeQuantity, "delivery", input.quantity);
    await tx.update(products).set({ stockQuantity: money(afterQuantity) }).where(eq(products.id, product.id));
    const movement = await tx.insert(stockMovements).values({ productId: product.id, type: "delivery", quantity: money(getStockDelta("delivery", input.quantity)), beforeQuantity: money(beforeQuantity), afterQuantity: money(afterQuantity), quoteId: quote.id, quoteItemId: item.id, clientName: quote.clientName || null, responsible: input.responsible || null, notes: input.notes || null, occurredAt: input.deliveredAt }).$returningId();
    const inserted = await tx.insert(quoteItemDeliveries).values({ quoteId: quote.id, quoteItemId: item.id, productId: product.id, clientName: quote.clientName || null, deliveredQuantity: money(input.quantity), deliveredAt: input.deliveredAt, responsible: input.responsible || null, notes: input.notes || null, stockMovementId: movement[0]!.id }).$returningId();
    const remainingReservation = calculateRemainingReservation(toNumber(reservation.reservedQuantity), input.quantity);
    if (remainingReservation <= 0) await tx.delete(quoteItemReservations).where(eq(quoteItemReservations.id, reservation.id));
    else await tx.update(quoteItemReservations).set({ reservedQuantity: money(remainingReservation) }).where(eq(quoteItemReservations.id, reservation.id));
    return { deliveryId: inserted[0]!.id, deliveredQuantity: input.quantity, pendingQuantity: delivery.pending - input.quantity, stockQuantity: afterQuantity };
  });
}
