import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  appointments,
  clients,
  financePayments,
  financeReceivables,
  products,
  quoteItemDeliveries,
  quoteItems,
  quoteItemReservations,
  quotePdfHistory,
  quoteRooms,
  quotes,
  stockMovements,
  storeSettings,
} from "../drizzle/schema";
import { calculateQuote, toNumber } from "../shared/quote";
import { aggregateDashboardStatuses, aggregateMonthlyPerformance, conversionRate } from "../shared/dashboardMetrics";
import { getExpirationAlerts, matchesExpirationQuickFilter, type ExpirationQuickFilter } from "../shared/quoteAlerts";
import { matchesQuoteStatusFilter, type QuoteStatusFilter } from "../shared/quoteStatus";
import { buildPickingList } from "../shared/picking";
import { nextProductCode } from "../shared/productCodes";
import { getDb } from "./db";
import { createReceivablesFromQuote, financeOverview } from "./financeDb";
import { allocatePendingReservations, fulfillmentLines } from "./stockDb";

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
  pixCity: null,
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
  pixCity: string | null;
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
  barcode?: string | null;
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
    // O campo do catálogo existia, mas o valor era descartado aqui.
    ...(input.barcode !== undefined ? { barcode: input.barcode?.trim() || null } : {}),
  };
  if (input.barcode) {
    const owner = (await db.select({ id: products.id, shortDescription: products.shortDescription }).from(products).where(eq(products.barcode, input.barcode.trim())).limit(1))[0];
    if (owner && owner.id !== input.id) throw new Error(`Este código de barras já está no produto "${owner.shortDescription}".`);
  }
  if (input.id) {
    await db.update(products).set(values).where(eq(products.id, input.id));
    return input.id;
  }
  // Dois cadastros ao mesmo tempo disputam a mesma trava e o MySQL derruba
  // um deles por deadlock; nesse caso basta tentar de novo.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM ${products} FOR UPDATE`);
        const existingCodes = await tx.select({ code: products.code }).from(products);
        const inserted = await tx.insert(products).values({ ...values, code: nextProductCode(existingCodes.map((product) => product.code)), stockQuantity: "0.00" }).$returningId();
        return inserted[0]!.id;
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
      if (code !== "ER_LOCK_DEADLOCK" || attempt >= 3) throw error;
    }
  }
}

export async function getProduct(id: number) {
  const db = await database();
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return rows[0] ?? null;
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

function toQuotePdfHistoryEntry(entry: typeof quotePdfHistory.$inferSelect) {
  return {
    id: entry.id,
    quoteId: entry.quoteId,
    fileName: entry.fileName,
    fileSize: entry.fileSize,
    createdAt: entry.createdAt,
    downloadUrl: `/api/quote-pdfs/${entry.id}/download`,
  };
}

export async function listQuotePdfHistory(quoteId: number) {
  const db = await database();
  const entries = await db.select().from(quotePdfHistory).where(eq(quotePdfHistory.quoteId, quoteId)).orderBy(desc(quotePdfHistory.createdAt));
  return entries.map(toQuotePdfHistoryEntry);
}

export async function listAllQuotePdfHistory() {
  const db = await database();
  const entries = await db.select({ entry: quotePdfHistory, quoteNumber: quotes.quoteNumber, clientName: quotes.clientName })
    .from(quotePdfHistory)
    .leftJoin(quotes, eq(quotePdfHistory.quoteId, quotes.id))
    .orderBy(desc(quotePdfHistory.createdAt));
  return entries.map(({ entry, quoteNumber, clientName }) => ({
    ...toQuotePdfHistoryEntry(entry),
    quoteNumber: quoteNumber ?? null,
    clientName: clientName ?? null,
  }));
}

export async function createQuotePdfHistory(input: { quoteId: number; createdByUserId: number; fileName: string; storageKey: string; fileSize: number }) {
  const db = await database();
  const quote = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
  if (!quote[0]) throw new Error("Orçamento não encontrado.");
  const inserted = await db.insert(quotePdfHistory).values(input).$returningId();
  const entries = await db.select().from(quotePdfHistory).where(eq(quotePdfHistory.id, inserted[0]!.id)).limit(1);
  if (!entries[0]) throw new Error("Não foi possível registrar o histórico de PDF.");
  return toQuotePdfHistoryEntry(entries[0]);
}

export async function getQuotePdfHistoryEntry(id: number) {
  const db = await database();
  const entries = await db.select().from(quotePdfHistory).where(eq(quotePdfHistory.id, id)).limit(1);
  return entries[0] ?? null;
}

async function hydrateQuotes<TQuote extends { id: number }>(db: Awaited<ReturnType<typeof database>>, quoteRows: TQuote[]) {
  const quoteIds = quoteRows.map((quote) => quote.id);
  const allRooms = quoteIds.length ? await db.select().from(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds)) : [];
  const roomIds = allRooms.map((room) => room.id);
  const allItems = roomIds.length ? await db.select().from(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds)) : [];
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
  return quoteRows.map((quote) => {
    const rooms = roomsByQuote.get(quote.id) ?? [];
    return { ...quote, rooms, summary: pricingForQuote(quote as unknown as typeof quotes.$inferSelect, rooms) };
  });
}

// Usado internamente (ex.: pelo dashboard, para calcular agregados sobre
// TODO o histórico) — busca todos os orçamentos, sem filtro nem paginação.
// Não usar diretamente para alimentar a listagem da tela de orçamentos:
// use listQuotesPaged, que filtra e pagina no servidor.
export async function listQuotes() {
  const db = await database();
  const allQuotes = await db.select().from(quotes).orderBy(desc(quotes.updatedAt));
  return hydrateQuotes(db, allQuotes);
}

export type QuoteListFilters = {
  search?: string;
  status?: QuoteStatusFilter;
  expiration?: ExpirationQuickFilter;
  page?: number;
  pageSize?: number;
};

const DEFAULT_QUOTE_PAGE_SIZE = 25;
const MAX_QUOTE_PAGE_SIZE = 100;

// Busca e filtra (texto, status, validade) sobre TODO o histórico de
// orçamentos antes de paginar — assim a busca continua encontrando um
// orçamento antigo mesmo que ele não esteja na página atual. Só depois de
// filtrar e cortar a página é que ambientes/itens são buscados, apenas
// para os poucos orçamentos que serão realmente exibidos.
export async function listQuotesPaged(filters: QuoteListFilters = {}) {
  const db = await database();
  const allQuotes = await db.select().from(quotes).orderBy(desc(quotes.updatedAt));
  const term = (filters.search ?? "").trim().toLocaleLowerCase("pt-BR");
  const statusFilter = filters.status ?? "all";
  const expirationFilter = filters.expiration ?? "all";
  const matched = allQuotes.filter(
    (quote) =>
      (!term || `${quote.quoteNumber} ${quote.clientName} ${quote.professional}`.toLocaleLowerCase("pt-BR").includes(term)) &&
      matchesQuoteStatusFilter(quote.status, statusFilter) &&
      matchesExpirationQuickFilter(quote, expirationFilter)
  );
  const total = matched.length;
  const pageSize = Math.min(MAX_QUOTE_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_QUOTE_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, filters.page ?? 1));
  const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  const hydrated = await hydrateQuotes(db, pageRows);
  return { quotes: hydrated, total, page, pageSize, totalPages };
}

// Ficha do cliente: orçamentos vinculados e situação financeira consolidada.
export async function customerStatement(clientId: number) {
  const db = await database();
  const clientRows = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  const client = clientRows[0];
  if (!client) return null;
  const [quoteRows, finance] = await Promise.all([
    db.select().from(quotes).where(eq(quotes.clientId, clientId)).orderBy(desc(quotes.issueDate)),
    financeOverview(),
  ]);
  const hydrated = await hydrateQuotes(db, quoteRows);
  const receivables = finance.receivables.filter((receivable) => receivable.clientId === clientId || (receivable.quoteId !== null && quoteRows.some((quote) => quote.id === receivable.quoteId)));
  const active = receivables.filter((receivable) => receivable.status !== "cancelled");
  const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
  return {
    client,
    quotes: hydrated.map((quote) => ({ id: quote.id, quoteNumber: quote.quoteNumber, status: quote.status, issueDate: quote.issueDate, validUntil: quote.validUntil, total: quote.summary.total })),
    totals: {
      quoted: sum(hydrated.filter((quote) => quote.status !== "lost").map((quote) => quote.summary.total)),
      approved: sum(hydrated.filter((quote) => quote.status === "approved").map((quote) => quote.summary.total)),
      received: sum(active.map((receivable) => receivable.receivedAmount)),
      outstanding: sum(active.map((receivable) => receivable.remainingAmount)),
      overdue: sum(active.filter((receivable) => receivable.overdue).map((receivable) => receivable.remainingAmount)),
      conversionRate: conversionRate(hydrated),
    },
  };
}

export async function getPickingList(quoteId: number) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error("Orçamento não encontrado");
  const lines = await fulfillmentLines([quoteId]);
  return {
    quote: { id: quote.id, quoteNumber: quote.quoteNumber, clientName: quote.clientName, professional: quote.professional, status: quote.status, issueDate: quote.issueDate, validUntil: quote.validUntil },
    items: buildPickingList(lines.map((line) => ({ quoteItemId: line.quoteItemId, productId: line.productId, barcode: line.barcode, code: line.code, shortDescription: line.shortDescription, fullDescription: line.fullDescription, unit: line.unit, quantity: line.pendingQuantity, orderedQuantity: line.orderedQuantity, deliveredQuantity: line.deliveredQuantity, deliverableQuantity: line.deliverableQuantity, roomName: line.roomName }))),
  };
}

export function isDuplicateQuoteNumberError(error: unknown) {
  // O drizzle 0.45 embrulha o erro do mysql2 num DrizzleQueryError, com o
  // erro original em `cause`; sem desembrulhar, o retry nunca disparava.
  const cause = (error as { cause?: unknown } | null)?.cause;
  const mysqlError = (cause && typeof cause === "object" ? cause : error) as { code?: string; errno?: number; message?: string } | null;
  if (!mysqlError) return false;
  const isDuplicateEntry = mysqlError.code === "ER_DUP_ENTRY" || mysqlError.errno === 1062;
  return isDuplicateEntry && (!mysqlError.message || mysqlError.message.includes("quoteNumber"));
}

export async function createQuote() {
  const settings = await getSettings();
  const db = await database();
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // O próximo número é "maior nº existente + 1", calculado fora de um
    // lock: duas criações quase simultâneas podem calcular o mesmo valor.
    // Como quoteNumber é UNIQUE no banco, a segunda tentativa falha aqui —
    // em vez de propagar esse erro cru, recalculamos e tentamos de novo.
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
    try {
      return await saveQuote(draft);
    } catch (error) {
      if (isDuplicateQuoteNumberError(error) && attempt < maxAttempts) {
        // Espera curta e aleatória para as criações simultâneas não
        // colidirem de novo no mesmo número.
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 80));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Não foi possível gerar um novo número de orçamento. Tente novamente.");
}

// Itens, valores e condições de pagamento: o que não pode mudar enquanto o
// orçamento está aprovado (há reserva de estoque e parcelas geradas).
type Amount = number | string;
function commercialTerms(quote: { discountMode: string; discountValue: Amount; shipping: Amount; pixDiscountMode: string; pixDiscountValue: Amount; installments: number; rooms: Array<{ name: string; items: Array<{ productId?: number | null; code: string; shortDescription: string; unit: string; quantity: Amount; unitPrice: Amount }> }> }) {
  const n = (value: Amount) => Math.round(Number(value) * 100) / 100;
  return JSON.stringify({
    discountMode: quote.discountMode, discountValue: n(quote.discountValue), shipping: n(quote.shipping),
    pixDiscountMode: quote.pixDiscountMode, pixDiscountValue: n(quote.pixDiscountValue), installments: Math.floor(quote.installments),
    rooms: quote.rooms.map((room) => ({ name: room.name || "AMBIENTE", items: room.items.map((item) => ({ productId: item.productId || null, code: item.code, shortDescription: item.shortDescription, unit: item.unit || "UN", quantity: n(item.quantity), unitPrice: n(item.unitPrice) })) })),
  });
}

export async function saveQuote(input: QuoteDraft, createdByUserId = 0) {
  const db = await database();
  const before = input.id ? await getQuote(input.id) : null;
  return db.transaction(async (tx) => {
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
    const releasedProducts: number[] = [];
    if (quoteId) {
      await tx.execute(sql`SELECT id FROM ${quotes} WHERE ${eq(quotes.id, quoteId)} FOR UPDATE`);
      const existingQuote = (await tx.select({ id: quotes.id, quoteNumber: quotes.quoteNumber, status: quotes.status, approvedAt: quotes.approvedAt }).from(quotes).where(eq(quotes.id, quoteId)).limit(1))[0];
      if (!existingQuote) throw new Error("Orçamento não encontrado. Ele pode ter sido excluído por outra pessoa.");
      // O número do orçamento é atribuído na criação e nunca muda depois.
      quoteValues.quoteNumber = existingQuote.quoteNumber;
      const existingRooms = await tx.select({ id: quoteRooms.id }).from(quoteRooms).where(eq(quoteRooms.quoteId, quoteId));
      const existingRoomIds = existingRooms.map((room) => room.id);
      const existingItems = existingRoomIds.length ? await tx.select({ id: quoteItems.id }).from(quoteItems).where(inArray(quoteItems.quoteRoomId, existingRoomIds)) : [];
      const existingItemIds = existingItems.map((item) => item.id);
      const [reservations, deliveries] = existingItemIds.length
        ? await Promise.all([
          tx.select().from(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, existingItemIds)),
          tx.select({ id: quoteItemDeliveries.id }).from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, existingItemIds)).limit(1),
        ])
        : [[], []];

      if (existingQuote.status === "approved" && input.status === "approved") {
        // Continua aprovado: só os dados do cliente, datas e observações mudam.
        if (before && commercialTerms(before) !== commercialTerms(input)) {
          throw new Error(deliveries.length
            ? "Este orçamento já tem retiradas registradas: itens, valores e condições não podem mais ser alterados."
            : "Orçamento aprovado: para alterar itens, valores ou condições, mude o status para Em aberto (a reserva de estoque será liberada).");
        }
        const { discountMode, discountValue, shipping, pixDiscountMode, pixDiscountValue, installments, status, ...header } = quoteValues;
        await tx.update(quotes).set(header).where(eq(quotes.id, quoteId));
        return quoteId;
      }
      if (deliveries.length) throw new Error("Este orçamento já tem retiradas registradas e não pode sair do status Aprovado.");
      if (reservations.length) {
        await tx.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, existingItemIds));
        releasedProducts.push(...reservations.map((row) => row.productId));
      }
      if (existingItemIds.length) await tx.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, existingRoomIds));
      await tx.delete(quoteRooms).where(eq(quoteRooms.quoteId, quoteId));
      await tx.update(quotes).set({ ...quoteValues, approvedAt: input.status === "approved" ? new Date() : null }).where(eq(quotes.id, quoteId));
    } else {
      const inserted = await tx.insert(quotes).values({ ...quoteValues, approvedAt: input.status === "approved" ? new Date() : null }).$returningId();
      quoteId = inserted[0]!.id;
    }
    const approvedProducts: number[] = [];
    for (let roomIndex = 0; roomIndex < input.rooms.length; roomIndex += 1) {
      const room = input.rooms[roomIndex]!;
      const insertedRoom = await tx.insert(quoteRooms).values({ quoteId, name: room.name || "AMBIENTE", sortOrder: roomIndex }).$returningId();
      const quoteRoomId = insertedRoom[0]!.id;
      for (let itemIndex = 0; itemIndex < room.items.length; itemIndex += 1) {
        const item = room.items[itemIndex]!;
        await tx.insert(quoteItems).values({
          quoteRoomId,
          productId: item.productId || null,
          code: item.code,
          shortDescription: item.shortDescription,
          imageUrl: item.imageUrl || null,
          unit: item.unit || "UN",
          quantity: money(item.quantity),
          unitPrice: money(item.unitPrice),
          sortOrder: itemIndex,
        });
        if (input.status === "approved" && item.productId) approvedProducts.push(item.productId);
      }
    }
    // Aprovar não depende de ter tudo em estoque: reserva o que houver e o
    // restante aparece em Compras. Reserva liberada vai para quem esperava.
    await allocatePendingReservations(tx, [...approvedProducts, ...releasedProducts]);
    return quoteId!;
  }).then(async (quoteId) => {
    const saved = await getQuote(quoteId);
    if (saved?.status === "approved") await createReceivablesFromQuote(saved, createdByUserId);
    return saved;
  });
}

export async function deleteQuote(id: number) {
  const db = await database();
  await db.transaction(async (tx) => {
    // Um orçamento aprovado pode já ter gerado cobranças financeiras
    // (financeReceivables). Essa tabela não tem chave estrangeira para
    // quotes — excluir o orçamento sem checar isso deixaria cobranças
    // reais (dinheiro devido por um cliente) órfãs silenciosamente, sem
    // nenhum erro, e sem jeito de rastrear a que orçamento pertenciam.
    const receivables = await tx.select({ id: financeReceivables.id }).from(financeReceivables).where(eq(financeReceivables.quoteId, id)).limit(1);
    if (receivables.length) throw new Error("Este orçamento possui cobranças financeiras geradas e não pode ser excluído.");
    const roomRows = await tx.select({ id: quoteRooms.id }).from(quoteRooms).where(eq(quoteRooms.quoteId, id));
    const roomIds = roomRows.map((room) => room.id);
    if (roomIds.length) {
      const itemRows = await tx.select({ id: quoteItems.id }).from(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds));
      const itemIds = itemRows.map((item) => item.id);
      if (itemIds.length) {
        const deliveries = await tx.select({ id: quoteItemDeliveries.id }).from(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteItemId, itemIds)).limit(1);
        if (deliveries.length) throw new Error("Este orçamento possui entregas registradas e não pode ser excluído.");
        const released = await tx.select({ productId: quoteItemReservations.productId }).from(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, itemIds));
        await tx.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteItemId, itemIds));
        await tx.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds));
        await tx.delete(quoteRooms).where(eq(quoteRooms.quoteId, id));
        await tx.delete(quotes).where(eq(quotes.id, id));
        await allocatePendingReservations(tx, released.map((row) => row.productId));
        return;
      }
    }
    await tx.delete(quoteRooms).where(eq(quoteRooms.quoteId, id));
    await tx.delete(quotes).where(eq(quotes.id, id));
  });
}

export async function dashboardMetrics() {
  const [allQuotes, settings, finance] = await Promise.all([listQuotes(), getSettings(), financeOverview()]);
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
    finance: finance.totals,
    conversionRate: conversionRate(allQuotes),
    monthly: aggregateMonthlyPerformance(allQuotes, finance.receivables.flatMap((receivable) => receivable.payments)),
  };
}

export async function exportBackup() {
  const db = await database();
  const [clientRows, productRows, quoteRows, roomRows, itemRows, pdfHistoryRows, receivableRows, paymentRows, reservationRows, deliveryRows, movementRows, settingRows, appointmentRows] = await Promise.all([
    db.select().from(clients),
    db.select().from(products),
    db.select().from(quotes),
    db.select().from(quoteRooms),
    db.select().from(quoteItems),
    db.select().from(quotePdfHistory),
    db.select().from(financeReceivables),
    db.select().from(financePayments),
    db.select().from(quoteItemReservations),
    db.select().from(quoteItemDeliveries),
    db.select().from(stockMovements),
    db.select().from(storeSettings),
    db.select().from(appointments),
  ]);
  return {
    format: "luminno-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { clients: clientRows, products: productRows, quotes: quoteRows, quoteRooms: roomRows, quoteItems: itemRows, quotePdfHistory: pdfHistoryRows, financeReceivables: receivableRows, financePayments: paymentRows, quoteItemReservations: reservationRows, quoteItemDeliveries: deliveryRows, stockMovements: movementRows, storeSettings: settingRows, appointments: appointmentRows },
  };
}

// O backup é baixado como JSON, então datas voltam como strings ISO. As
// colunas timestamp do drizzle exigem Date (chamam toISOString), e sem esta
// conversão a restauração de qualquer backup real falhava.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export function reviveBackupDates<T>(value: T): T {
  if (typeof value === "string" && ISO_DATE.test(value)) {
    const date = new Date(value);
    return (Number.isNaN(date.getTime()) ? value : date) as T;
  }
  if (Array.isArray(value)) return value.map((entry) => reviveBackupDates(entry)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, reviveBackupDates(entry)])) as T;
  }
  return value;
}

export async function importBackup(input: { data: Record<string, unknown>; replace: boolean }) {
  const db = await database();
  const data = reviveBackupDates(input.data) as {
    clients?: Array<typeof clients.$inferInsert>;
    products?: Array<typeof products.$inferInsert>;
    quotes?: Array<typeof quotes.$inferInsert>;
    quoteRooms?: Array<typeof quoteRooms.$inferInsert>;
    quoteItems?: Array<typeof quoteItems.$inferInsert>;
    quotePdfHistory?: Array<typeof quotePdfHistory.$inferInsert>;
    financeReceivables?: Array<typeof financeReceivables.$inferInsert>;
    financePayments?: Array<typeof financePayments.$inferInsert>;
    quoteItemReservations?: Array<typeof quoteItemReservations.$inferInsert>;
    quoteItemDeliveries?: Array<typeof quoteItemDeliveries.$inferInsert>;
    stockMovements?: Array<typeof stockMovements.$inferInsert>;
    storeSettings?: Array<typeof storeSettings.$inferInsert>;
    appointments?: Array<typeof appointments.$inferInsert>;
  };
  await db.transaction(async (tx) => {
    if (input.replace) {
      await tx.delete(stockMovements);
      await tx.delete(financePayments);
      await tx.delete(financeReceivables);
      await tx.delete(quoteItemDeliveries);
      await tx.delete(quoteItemReservations);
      await tx.delete(quotePdfHistory);
      await tx.delete(quoteItems);
      await tx.delete(quoteRooms);
      await tx.delete(quotes);
      await tx.delete(products);
      await tx.delete(clients);
      await tx.delete(storeSettings);
      await tx.delete(appointments);
    }
    if (data.clients?.length) await tx.insert(clients).values(data.clients).onDuplicateKeyUpdate({ set: { name: sql`values(name)`, professional: sql`values(professional)` } });
    if (data.products?.length) await tx.insert(products).values(data.products).onDuplicateKeyUpdate({ set: { shortDescription: sql`values(shortDescription)`, unitPrice: sql`values(unitPrice)`, active: sql`values(active)` } });
    if (data.quotes?.length) await tx.insert(quotes).values(data.quotes).onDuplicateKeyUpdate({ set: { clientName: sql`values(clientName)`, professional: sql`values(professional)`, status: sql`values(status)` } });
    if (data.quoteRooms?.length) await tx.insert(quoteRooms).values(data.quoteRooms).onDuplicateKeyUpdate({ set: { name: sql`values(name)`, sortOrder: sql`values(sortOrder)` } });
    if (data.quoteItems?.length) await tx.insert(quoteItems).values(data.quoteItems).onDuplicateKeyUpdate({ set: { shortDescription: sql`values(shortDescription)`, quantity: sql`values(quantity)`, unitPrice: sql`values(unitPrice)` } });
    if (data.quotePdfHistory?.length) await tx.insert(quotePdfHistory).values(data.quotePdfHistory).onDuplicateKeyUpdate({ set: { quoteId: sql`values(quoteId)`, fileName: sql`values(fileName)`, fileSize: sql`values(fileSize)` } });
    if (data.financeReceivables?.length) await tx.insert(financeReceivables).values(data.financeReceivables).onDuplicateKeyUpdate({ set: { clientName: sql`values(clientName)`, description: sql`values(description)`, originalAmount: sql`values(originalAmount)`, dueDate: sql`values(dueDate)`, status: sql`values(status)` } });
    if (data.financePayments?.length) await tx.insert(financePayments).values(data.financePayments).onDuplicateKeyUpdate({ set: { amount: sql`values(amount)`, paidAt: sql`values(paidAt)`, reference: sql`values(reference)`, notes: sql`values(notes)` } });
    if (data.quoteItemReservations?.length) await tx.insert(quoteItemReservations).values(data.quoteItemReservations).onDuplicateKeyUpdate({ set: { reservedQuantity: sql`values(reservedQuantity)`, reservedAt: sql`values(reservedAt)` } });
    if (data.quoteItemDeliveries?.length) await tx.insert(quoteItemDeliveries).values(data.quoteItemDeliveries).onDuplicateKeyUpdate({ set: { deliveredQuantity: sql`values(deliveredQuantity)`, deliveredAt: sql`values(deliveredAt)`, responsible: sql`values(responsible)` } });
    if (data.stockMovements?.length) await tx.insert(stockMovements).values(data.stockMovements).onDuplicateKeyUpdate({ set: { quantity: sql`values(quantity)`, afterQuantity: sql`values(afterQuantity)`, occurredAt: sql`values(occurredAt)` } });
    if (data.appointments?.length) await tx.insert(appointments).values(data.appointments).onDuplicateKeyUpdate({ set: { status: sql`values(status)`, scheduledAt: sql`values(scheduledAt)`, notes: sql`values(notes)` } });
    if (data.storeSettings?.length) await tx.insert(storeSettings).values(data.storeSettings).onDuplicateKeyUpdate({ set: { companyName: sql`values(companyName)`, pixKey: sql`values(pixKey)`, defaultTerms: sql`values(defaultTerms)` } });
  });
  return { imported: true };
}
