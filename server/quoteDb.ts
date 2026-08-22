import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  clients,
  products,
  quoteItemDeliveries,
  quoteItems,
  quoteItemReservations,
  quoteRooms,
  quotes,
  stockMovements,
  storeSettings,
} from "../drizzle/schema";
import { calculateQuote, toNumber } from "../shared/quote";
import { aggregateDashboardStatuses } from "../shared/dashboardMetrics";
import { getExpirationAlerts } from "../shared/quoteAlerts";
import { buildPickingList } from "../shared/picking";
import { nextProductCode } from "../shared/productCodes";
import { assertReservableQuantity } from "../shared/stock";
import { getDb } from "./db";

export type QuoteDraft = {
  id?: number;
  quoteNumber?: number;
  clientId?: number | null;
  clientName: string;
  professional: string;
  document?: string | null;
  stateRegistration?: string | null;
  phone?: string | null;
  address?: string | null;
  status: "draft" | "open" | "approved" | "lost";
  issueDate: Date;
  validUntil?: Date | null;
  discountMode: "percentage" | "fixed";
  discountValue: number;
  shipping: number;
  pixDiscountMode: "percentage" | "fixed";
  pixDiscountValue: number;
  installments: number;
  notes?: string | null;
  rooms: Array<{
    id?: number;
    name: string;
    items: Array<{
      id?: number;
      productId?: number | null;
      code: string;
      shortDescription: string;
      imageUrl?: string | null;
      unit: string;
      quantity: number;
      unitPrice: number;
    }>;
  }>;
};

const DEFAULT_SETTINGS = {
  id: 1,
  companyName: "Luminno Iluminação",
  tradingName: "Luminno",
  logoUrl: null,
  document: null,
  address: null,
  phone: null,
  email: null,
  pixKey: null,
  pixRecipient: null,
  defaultPixDiscountMode: "percentage" as const,
  defaultPixDiscountValue: "0",
  defaultInstallments: 8,
  alertThresholdDays: 7,
  defaultTerms: "Valores válidos conforme prazo indicado. Parcelamento sem juros sujeito à análise.",
};

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

const money = (value: number) => value.toFixed(2);

export async function getSettings() {
  const db = await database();
  const rows = await db.select().from(storeSettings).where(eq(storeSettings.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(storeSettings).values(DEFAULT_SETTINGS).onDuplicateKeyUpdate({
    set: { updatedAt: new Date() },
  });
  const initialized = await db.select().from(storeSettings).where(eq(storeSettings.id, 1)).limit(1);
  return initialized[0] ?? { ...DEFAULT_SETTINGS, updatedAt: new Date() };
}

export async function saveSettings(input: {
  companyName: string;
  tradingName: string;
  logoUrl: string | null;
  document: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  pixKey: string | null;
  pixRecipient: string | null;
  defaultPixDiscountMode: "percentage" | "fixed";
  defaultPixDiscountValue: string;
  defaultInstallments: number;
  alertThresholdDays: number;
  defaultTerms: string | null;
}) {
  const db = await database();
  await db.insert(storeSettings).values({ id: 1, ...input }).onDuplicateKeyUpdate({
    set: { ...input },
  });
  return getSettings();
}

export async function listClients(search?: string) {
  const db = await database();
  const all = await db.select().from(clients).orderBy(desc(clients.updatedAt));
  const needle = search?.trim().toLocaleLowerCase("pt-BR");
  const filtered = needle
    ? all.filter((client) => `${client.name} ${client.professional}`.toLocaleLowerCase("pt-BR").includes(needle))
    : all;
  const counts = await db.select({ clientId: quotes.clientId, count: sql<number>`count(*)` }).from(quotes).groupBy(quotes.clientId);
  const countMap = new Map(counts.map((row) => [row.clientId, Number(row.count)]));
  return filtered.map((client) => ({ ...client, quoteCount: countMap.get(client.id) ?? 0 }));
}

export async function saveClient(input: {
  id?: number;
  name: string;
  professional: string;
  document?: string | null;
  stateRegistration?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}) {
  const db = await database();
  const values = {
    name: input.name,
    professional: input.professional,
    document: input.document || null,
    stateRegistration: input.stateRegistration || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
  };
  if (input.id) {
    await db.update(clients).set(values).where(eq(clients.id, input.id));
    return input.id;
  }
  const inserted = await db.insert(clients).values(values).$returningId();
  return inserted[0]!.id;
}

export async function listProducts(search?: string) {
  const db = await database();
  const all = await db.select().from(products).orderBy(desc(products.updatedAt));
  const needle = search?.trim().toLocaleLowerCase("pt-BR");
  return needle
    ? all.filter((product) => `${product.code} ${product.shortDescription} ${product.supplierName ?? ""}`.toLocaleLowerCase("pt-BR").includes(needle))
    : all;
}

export async function saveProduct(input: {
  id?: number;
  code?: string;
  shortDescription: string;
  fullDescription?: string | null;
  imageUrl?: string | null;
  imageKey?: string | null;
  unit: string;
  supplierName?: string | null;
  unitPrice: number;
  reorderPoint?: number;
  active: boolean;
}) {
  const db = await database();
  const values = {
    shortDescription: input.shortDescription,
    fullDescription: input.fullDescription || null,
    imageUrl: input.imageUrl || null,
    imageKey: input.imageKey || null,
    unit: input.unit || "UN",
    supplierName: input.supplierName || null,
    unitPrice: money(input.unitPrice),
    reorderPoint: money(input.reorderPoint ?? 0),
    active: input.active,
  };
  if (input.id) {
    await db.update(products).set(values).where(eq(products.id, input.id));
    return input.id;
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${products} FOR UPDATE`);
    const existingCodes = await tx.select({ code: products.code }).from(products);
    const inserted = await tx.insert(products).values({ ...values, code: nextProductCode(existingCodes.map((product) => product.code)), stockQuantity: "0.00" }).$returningId();
    return inserted[0]!.id;
  });
}

export async function deleteProduct(id: number) {
  const db = await database();
  await db.update(products).set({ active: false }).where(eq(products.id, id));
}

function pricingForQuote(
  quote: Pick<QuoteDraft, "discountMode" | "pixDiscountMode" | "installments"> & {
    discountValue: string | number;
    shipping: string | number;
    pixDiscountValue: string | number;
  },
  rooms: Array<{ items: Array<{ quantity: string | number; unitPrice: string | number }> }>,
) {
  return calculateQuote({
    rooms: rooms.map((room) => ({
      items: room.items.map((item) => ({ quantity: toNumber(item.quantity), unitPrice: toNumber(item.unitPrice) })),
    })),
    discountMode: quote.discountMode,
    discountValue: toNumber(quote.discountValue),
    shipping: toNumber(quote.shipping),
    pixDiscountMode: quote.pixDiscountMode,
    pixDiscountValue: toNumber(quote.pixDiscountValue),
    installments: quote.installments,
  });
}

export async function getQuote(id: number) {
  const db = await database();
  const quoteRows = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  const quote = quoteRows[0];
  if (!quote) return null;
  const rooms = await db.select().from(quoteRooms).where(eq(quoteRooms.quoteId, id)).orderBy(quoteRooms.sortOrder);
  const roomIds = rooms.map((room) => room.id);
  const items = roomIds.length ? await db.select().from(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds)).orderBy(quoteItems.sortOrder) : [];
  const roomsWithItems = rooms.map((room) => ({
    ...room,
    items: items.filter((item) => item.quoteRoomId === room.id),
  }));
  return { ...quote, rooms: roomsWithItems, summary: pricingForQuote(quote, roomsWithItems) };
}

export async function listQuotes() {
  const db = await database();
  const allQuotes = await db.select().from(quotes).orderBy(desc(quotes.updatedAt));
  const allRooms = await db.select().from(quoteRooms);
  const allItems = await db.select().from(quoteItems);
  const itemsByRoom = new Map<number, typeof allItems>();
  allItems.forEach((item) => {
    const existing = itemsByRoom.get(item.quoteRoomId) ?? [];
    existing.push(item);
    itemsByRoom.set(item.quoteRoomId, existing);
  });
  const roomsByQuote = new Map<number, Array<(typeof allRooms)[number] & { items: typeof allItems }>>();
  allRooms.forEach((room) => {
    const existing = roomsByQuote.get(room.quoteId) ?? [];
    existing.push({ ...room, items: itemsByRoom.get(room.id) ?? [] });
    roomsByQuote.set(room.quoteId, existing);
  });
  return allQuotes.map((quote) => {
    const rooms = roomsByQuote.get(quote.id) ?? [];
    return { ...quote, rooms, summary: pricingForQuote(quote, rooms) };
  });
}

export async function getPickingList(quoteId: number) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error("Orçamento não encontrado");
  const productIds = quote.rooms.flatMap((room) => room.items.map((item) => item.productId).filter((productId): productId is number => Boolean(productId)));
  const db = await database();
  const productRows = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const productMap = new Map(productRows.map((product) => [product.id, product]));
  return {
    quote: { id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, professional: quote.professional, status: quote.status, issueDate: quote.issueDate, validUntil: quote.validUntil },
    items: buildPickingList(quote.rooms.flatMap((room) => room.items.map((item) => ({ productId: item.productId, code: item.code, shortDescription: item.shortDescription, fullDescription: item.productId ? productMap.get(item.productId)?.fullDescription : null, unit: item.unit, quantity: toNumber(item.quantity), roomName: room.name })))),
  };
}

export async function createQuote() {
  const settings = await getSettings();
  const db = await database();
  const highest = await db.select({ value: sql<number>`coalesce(max(${quotes.quoteNumber}), 0)` }).from(quotes);
  const quoteNumber = Number(highest[0]?.value ?? 0) + 1;
  const date = new Date();
  const validUntil = new Date(date);
  validUntil.setDate(validUntil.getDate() + 7);
  const draft: QuoteDraft = {
    quoteNumber,
    clientName: "",
    professional: "",
    status: "draft",
    issueDate: date,
    validUntil,
    discountMode: "percentage",
    discountValue: 0,
    shipping: 0,
    pixDiscountMode: settings.defaultPixDiscountMode,
    pixDiscountValue: toNumber(settings.defaultPixDiscountValue),
    installments: settings.defaultInstallments,
    notes: settings.defaultTerms,
    rooms: [{ name: "GERAL", items: [] }],
  };
  return saveQuote(draft);
}

export async function saveQuote(input: QuoteDraft) {
  const db = await database();
  return db.transaction(async (tx) => {
    if (input.status === "approved") {
      const requestedByProduct = new Map<number, number>();
      input.rooms.forEach((room) => room.items.forEach((item) => {
        if (item.productId) requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + item.quantity);
      }));
      const productIds = Array.from(requestedByProduct.keys());
      if (productIds.length) {
        await tx.execute(sql`SELECT id FROM ${products} WHERE ${inArray(products.id, productIds)} FOR UPDATE`);
        const [stockProducts, activeReservations] = await Promise.all([
          tx.select().from(products).where(inArray(products.id, productIds)),
          tx.select().from(quoteItemReservations).where(inArray(quoteItemReservations.productId, productIds)),
        ]);
        const reservedByProduct = new Map<number, number>();
        activeReservations.forEach((reservation) => reservedByProduct.set(reservation.productId, (reservedByProduct.get(reservation.productId) ?? 0) + toNumber(reservation.reservedQuantity)));
        productIds.forEach((productId) => {
          const product = stockProducts.find((candidate) => candidate.id === productId);
          if (!product) throw new Error("Produto de estoque não encontrado");
          assertReservableQuantity(toNumber(product.stockQuantity), reservedByProduct.get(productId) ?? 0, requestedByProduct.get(productId)!);
        });
      }
    }
    let quoteId = input.id;
    const quoteValues = {
      quoteNumber: input.quoteNumber ?? 1,
      clientId: input.clientId || null,
      clientName: input.clientName,
      professional: input.professional,
      document: input.document || null,
      stateRegistration: input.stateRegistration || null,
      phone: input.phone || null,
      address: input.address || null,
      status: input.status,
      issueDate: input.issueDate,
      validUntil: input.validUntil || null,
      discountMode: input.discountMode,
      discountValue: money(input.discountValue),
      shipping: money(input.shipping),
      pixDiscountMode: input.pixDiscountMode,
      pixDiscountValue: money(input.pixDiscountValue),
      installments: Math.max(1, Math.floor(input.installments)),
      notes: input.notes || null,
    };
    if (quoteId) {
      const existingRooms = await tx.select({ id: quoteRooms.id }).from(quoteRooms).where(eq(quoteRooms.quoteId, quoteId));
      const existingRoomIds = existingRooms.map((room) => room.id);
      if (existingRoomIds.length) {
        const existingItems = await tx.select({ id: quoteItems.id }).from(quoteItems).where(inArray(quoteItems.quoteRoomId, existingRoomIds));
        const existingItemIds = existingItems.map((item) => item.id);
        if (existingItemIds.length) {
          const reservations = await tx.select({ id: quoteItemReservations.id }).from(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, existingItemIds));
          if (reservations.length && input.status === "approved") throw new Error("Este orçamento possui estoque reservado. Para alterar os itens, mude o status para pendente e salve para liberar a reserva.");
          if (reservations.length) await tx.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, existingItemIds));
          const deliveries = await tx.select({ id: quoteItemDeliveries.id }).from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, existingItemIds)).limit(1);
          if (deliveries.length) throw new Error("Este orçamento já possui entregas registradas. Para preservar o histórico, não altere seus itens.");
          await tx.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, existingRoomIds));
        }
      }
      await tx.delete(quoteRooms).where(eq(quoteRooms.quoteId, quoteId));
      await tx.update(quotes).set(quoteValues).where(eq(quotes.id, quoteId));
    } else {
      const inserted = await tx.insert(quotes).values(quoteValues).$returningId();
      quoteId = inserted[0]!.id;
    }
    for (let roomIndex = 0; roomIndex < input.rooms.length; roomIndex += 1) {
      const room = input.rooms[roomIndex]!;
      const insertedRoom = await tx.insert(quoteRooms).values({ quoteId, name: room.name || "AMBIENTE", sortOrder: roomIndex }).$returningId();
      const quoteRoomId = insertedRoom[0]!.id;
      if (room.items.length) {
        for (let itemIndex = 0; itemIndex < room.items.length; itemIndex += 1) {
          const item = room.items[itemIndex]!;
          const insertedItem = await tx.insert(quoteItems).values({
          quoteRoomId,
          productId: item.productId || null,
          code: item.code,
          shortDescription: item.shortDescription,
          imageUrl: item.imageUrl || null,
          unit: item.unit || "UN",
          quantity: money(item.quantity),
          unitPrice: money(item.unitPrice),
          sortOrder: itemIndex,
          }).$returningId();
          if (input.status === "approved" && item.productId) await tx.insert(quoteItemReservations).values({ quoteId, quoteItemId: insertedItem[0]!.id, productId: item.productId, reservedQuantity: money(item.quantity) });
        }
      }
    }
    return quoteId!;
  }).then((quoteId) => getQuote(quoteId));
}

export async function deleteQuote(id: number) {
  const db = await database();
  await db.transaction(async (tx) => {
    const roomRows = await tx.select({ id: quoteRooms.id }).from(quoteRooms).where(eq(quoteRooms.quoteId, id));
    const roomIds = roomRows.map((room) => room.id);
    if (roomIds.length) {
      const itemRows = await tx.select({ id: quoteItems.id }).from(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds));
      const itemIds = itemRows.map((item) => item.id);
      if (itemIds.length) {
        await tx.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, itemIds));
        const deliveries = await tx.select({ id: quoteItemDeliveries.id }).from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, itemIds)).limit(1);
        if (deliveries.length) throw new Error("Este orçamento possui entregas registradas e não pode ser excluído.");
        await tx.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds));
      }
    }
    await tx.delete(quoteRooms).where(eq(quoteRooms.quoteId, id));
    await tx.delete(quotes).where(eq(quotes.id, id));
  });
}

export async function dashboardMetrics() {
  const allQuotes = await listQuotes();
  const settings = await getSettings();
  const approved = allQuotes.filter((quote) => quote.status === "approved");
  const open = allQuotes.filter((quote) => quote.status === "open" || quote.status === "draft");
  const statusSummary = aggregateDashboardStatuses(allQuotes);
  const approvedStatus = statusSummary[0];
  const pendingStatus = statusSummary[1];
  const rejectedStatus = statusSummary[2];
  const expirationAlerts = getExpirationAlerts(allQuotes, new Date(), settings.alertThresholdDays).slice(0, 6);
  const approvedRevenue = approved.reduce((sum, quote) => sum + quote.summary.total, 0);
  const quotedTotal = allQuotes.filter((quote) => quote.status !== "lost").reduce((sum, quote) => sum + quote.summary.total, 0);
  const amountBase = allQuotes.filter((quote) => quote.status !== "lost");
  const productStats = new Map<string, { description: string; quantity: number; occurrences: number }>();
  allQuotes.forEach((quote) => quote.rooms.forEach((room) => room.items.forEach((item) => {
    const key = item.productId ? `product-${item.productId}` : `${item.code}-${item.shortDescription}`;
    const current = productStats.get(key) ?? { description: item.shortDescription, quantity: 0, occurrences: 0 };
    current.quantity += toNumber(item.quantity);
    current.occurrences += 1;
    productStats.set(key, current);
  })));
  return {
    approvedRevenue,
    quotedTotal,
    openCount: open.length,
    approvedCount: approvedStatus.count,
    pendingCount: pendingStatus.count,
    rejectedCount: rejectedStatus.count,
    approvedValue: approvedStatus.value,
    pendingValue: pendingStatus.value,
    rejectedValue: rejectedStatus.value,
    statusSummary,
    expirationAlerts,
    alertBrand: settings.tradingName,
    alertThresholdDays: settings.alertThresholdDays,
    averageTicket: amountBase.length ? amountBase.reduce((sum, quote) => sum + quote.summary.total, 0) / amountBase.length : 0,
    ranking: Array.from(productStats.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
  };
}

export async function exportBackup() {
  const db = await database();
  const [clientRows, productRows, quoteRows, roomRows, itemRows, reservationRows, deliveryRows, movementRows, settingRows] = await Promise.all([
    db.select().from(clients),
    db.select().from(products),
    db.select().from(quotes),
    db.select().from(quoteRooms),
    db.select().from(quoteItems),
    db.select().from(quoteItemReservations),
    db.select().from(quoteItemDeliveries),
    db.select().from(stockMovements),
    db.select().from(storeSettings),
  ]);
  return {
    format: "luminno-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { clients: clientRows, products: productRows, quotes: quoteRows, quoteRooms: roomRows, quoteItems: itemRows, quoteItemReservations: reservationRows, quoteItemDeliveries: deliveryRows, stockMovements: movementRows, storeSettings: settingRows },
  };
}

export async function importBackup(input: { data: Record<string, unknown>; replace: boolean }) {
  const db = await database();
  const data = input.data as {
    clients?: Array<typeof clients.$inferInsert>;
    products?: Array<typeof products.$inferInsert>;
    quotes?: Array<typeof quotes.$inferInsert>;
    quoteRooms?: Array<typeof quoteRooms.$inferInsert>;
    quoteItems?: Array<typeof quoteItems.$inferInsert>;
    quoteItemReservations?: Array<typeof quoteItemReservations.$inferInsert>;
    quoteItemDeliveries?: Array<typeof quoteItemDeliveries.$inferInsert>;
    stockMovements?: Array<typeof stockMovements.$inferInsert>;
    storeSettings?: Array<typeof storeSettings.$inferInsert>;
  };
  await db.transaction(async (tx) => {
    if (input.replace) {
      await tx.delete(stockMovements);
      await tx.delete(quoteItemDeliveries);
      await tx.delete(quoteItemReservations);
      await tx.delete(quoteItems);
      await tx.delete(quoteRooms);
      await tx.delete(quotes);
      await tx.delete(products);
      await tx.delete(clients);
      await tx.delete(storeSettings);
    }
    if (data.clients?.length) await tx.insert(clients).values(data.clients).onDuplicateKeyUpdate({ set: { name: sql`values(name)`, professional: sql`values(professional)` } });
    if (data.products?.length) await tx.insert(products).values(data.products).onDuplicateKeyUpdate({ set: { shortDescription: sql`values(shortDescription)`, unitPrice: sql`values(unitPrice)`, active: sql`values(active)` } });
    if (data.quotes?.length) await tx.insert(quotes).values(data.quotes).onDuplicateKeyUpdate({ set: { clientName: sql`values(clientName)`, professional: sql`values(professional)`, status: sql`values(status)` } });
    if (data.quoteRooms?.length) await tx.insert(quoteRooms).values(data.quoteRooms).onDuplicateKeyUpdate({ set: { name: sql`values(name)`, sortOrder: sql`values(sortOrder)` } });
    if (data.quoteItems?.length) await tx.insert(quoteItems).values(data.quoteItems).onDuplicateKeyUpdate({ set: { shortDescription: sql`values(shortDescription)`, quantity: sql`values(quantity)`, unitPrice: sql`values(unitPrice)` } });
    if (data.quoteItemReservations?.length) await tx.insert(quoteItemReservations).values(data.quoteItemReservations).onDuplicateKeyUpdate({ set: { reservedQuantity: sql`values(reservedQuantity)`, reservedAt: sql`values(reservedAt)` } });
    if (data.quoteItemDeliveries?.length) await tx.insert(quoteItemDeliveries).values(data.quoteItemDeliveries).onDuplicateKeyUpdate({ set: { deliveredQuantity: sql`values(deliveredQuantity)`, deliveredAt: sql`values(deliveredAt)`, responsible: sql`values(responsible)` } });
    if (data.stockMovements?.length) await tx.insert(stockMovements).values(data.stockMovements).onDuplicateKeyUpdate({ set: { quantity: sql`values(quantity)`, afterQuantity: sql`values(afterQuantity)`, occurredAt: sql`values(occurredAt)` } });
    if (data.storeSettings?.length) await tx.insert(storeSettings).values(data.storeSettings).onDuplicateKeyUpdate({ set: { companyName: sql`values(companyName)`, pixKey: sql`values(pixKey)`, defaultTerms: sql`values(defaultTerms)` } });
  });
  return { imported: true };
}
