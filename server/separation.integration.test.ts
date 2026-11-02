import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { financePayments, financeReceivables, products, quoteItemDeliveries, quoteItemReservations, quoteItems, quoteRooms, quotes, stockMovements } from "../drizzle/schema";
import { getDb } from "./db";
import { createQuote, getPickingList, saveProduct, saveQuote, type QuoteDraft } from "./quoteDb";
import { deliverAllAvailable, deliverQuoteItem, deliverQuoteItems, fulfillmentLines, purchaseSuggestions, recordStockMovement } from "./stockDb";

const productIds: number[] = [];
const quoteIds: number[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (quoteIds.length) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    if (receivables.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
    await db.delete(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    await db.delete(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteId, quoteIds));
    await db.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteId, quoteIds));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds));
    if (rooms.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id)));
    await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds));
    await db.delete(quotes).where(inArray(quotes.id, quoteIds));
  }
  if (productIds.length) {
    await db.delete(stockMovements).where(inArray(stockMovements.productId, productIds));
    await db.delete(products).where(inArray(products.id, productIds));
  }
  productIds.length = 0;
  quoteIds.length = 0;
});

async function product(stock: number) {
  const id = await saveProduct({ shortDescription: `Separação ${Date.now()}-${Math.random()}`, fullDescription: "Produto de teste", unit: "UN", supplierName: "Fornecedor teste", unitPrice: 10, reorderPoint: 0, active: true });
  productIds.push(id);
  if (stock) await recordStockMovement({ productId: id, type: "entry", quantity: stock, occurredAt: new Date() });
  return id;
}

async function quote(rooms: QuoteDraft["rooms"], status: QuoteDraft["status"] = "approved", extra: Partial<QuoteDraft> = {}) {
  const draft = (await createQuote())!;
  quoteIds.push(draft.id);
  const input: QuoteDraft = { id: draft.id, quoteNumber: draft.quoteNumber, clientName: "Cliente separação", professional: "", status, issueDate: new Date(), validUntil: null, discountMode: "percentage", discountValue: 0, shipping: 0, pixDiscountMode: "percentage", pixDiscountValue: 0, installments: 1, notes: "", rooms, ...extra };
  const saved = (await saveQuote(input, 0))!;
  return { saved, input };
}

const item = (productId: number | null, quantity: number) => ({ productId, code: productId ? `P${productId}` : "AV", shortDescription: productId ? `Produto ${productId}` : "Instalação avulsa", unit: "UN", quantity, unitPrice: 10 });
const lineOf = async (quoteId: number, quoteItemId: number) => (await fulfillmentLines([quoteId])).find((line) => line.quoteItemId === quoteItemId)!;

describe("separação e retiradas", () => {
  it("retira tudo o que está reservado para o item, mesmo sem estoque livre, e lista só o que falta", async () => {
    const productId = await product(10);
    const { saved } = await quote([{ name: "SALA", items: [item(productId, 10)] }]);
    const itemId = saved.rooms[0]!.items[0]!.id;
    expect(await lineOf(saved.id, itemId)).toMatchObject({ reservedQuantity: 10, availableQuantity: 0, deliverableQuantity: 10, shortageQuantity: 0 });

    await deliverQuoteItem({ quoteId: saved.id, quoteItemId: itemId, quantity: 4, deliveredAt: new Date() });
    const picking = await getPickingList(saved.id);
    expect(picking.items[0]).toMatchObject({ quantity: 6, orderedQuantity: 10, deliveredQuantity: 4, deliverableQuantity: 6 });

    await deliverAllAvailable({ quoteId: saved.id, deliveredAt: new Date() });
    expect(await lineOf(saved.id, itemId)).toMatchObject({ pendingQuantity: 0, reservedQuantity: 0, deliveredQuantity: 10, stockQuantity: 0 });
  }, 20_000);

  it("orçamento aprovado salva dados do cliente, mas recusa mudar itens", async () => {
    const productId = await product(5);
    const { saved, input } = await quote([{ name: "SALA", items: [item(productId, 5)] }]);
    await expect(saveQuote({ ...input, notes: "Entregar pela manhã", phone: "11999990000" }, 0)).resolves.toMatchObject({ notes: "Entregar pela manhã", phone: "11999990000", status: "approved" });
    expect((await fulfillmentLines([saved.id]))[0]).toMatchObject({ reservedQuantity: 5 });
    await expect(saveQuote({ ...input, rooms: [{ name: "SALA", items: [item(productId, 4)] }] }, 0)).rejects.toThrow(/mude o status para Em aberto/);
  }, 20_000);

  it("aprova sem estoque completo, aponta a falta e reserva quando a mercadoria chega, na ordem de aprovação", async () => {
    const productId = await product(3);
    const first = await quote([{ name: "SALA", items: [item(productId, 5)] }]);
    const second = await quote([{ name: "SALA", items: [item(productId, 4)] }]);
    const firstItem = first.saved.rooms[0]!.items[0]!.id;
    const secondItem = second.saved.rooms[0]!.items[0]!.id;
    expect(await lineOf(first.saved.id, firstItem)).toMatchObject({ reservedQuantity: 3, shortageQuantity: 2 });
    expect(await lineOf(second.saved.id, secondItem)).toMatchObject({ reservedQuantity: 0, shortageQuantity: 4 });
    const purchase = (await purchaseSuggestions()).flatMap((supplier) => supplier.lines).find((line) => line.productId === productId);
    expect(purchase).toMatchObject({ shortageQuantity: 6, freeQuantity: 0 });
    expect(purchase!.waitingQuotes.map((entry) => entry.quoteId)).toEqual([first.saved.id, second.saved.id]);

    await recordStockMovement({ productId, type: "entry", quantity: 4, occurredAt: new Date() });
    expect(await lineOf(first.saved.id, firstItem)).toMatchObject({ reservedQuantity: 5, shortageQuantity: 0 });
    expect(await lineOf(second.saved.id, secondItem)).toMatchObject({ reservedQuantity: 2, shortageQuantity: 2 });

    // O primeiro volta para Em aberto: a reserva liberada vai para o segundo.
    await saveQuote({ ...first.input, status: "open" }, 0);
    expect(await lineOf(second.saved.id, secondItem)).toMatchObject({ reservedQuantity: 4, shortageQuantity: 0 });
  }, 20_000);

  it("registra retirada de item avulso sem mexer no estoque e recusa frações de centavo", async () => {
    const productId = await product(2);
    const { saved } = await quote([{ name: "SALA", items: [item(productId, 2), item(null, 1)] }]);
    const [productItem, manualItem] = saved.rooms[0]!.items;
    await expect(deliverQuoteItem({ quoteId: saved.id, quoteItemId: productItem!.id, quantity: 0.005, deliveredAt: new Date() })).rejects.toThrow(/2 casas decimais/);
    await deliverQuoteItems({ quoteId: saved.id, lines: [{ quoteItemId: manualItem!.id, quantity: 1 }, { quoteItemId: productItem!.id, quantity: 1 }], deliveredAt: new Date() });
    expect(await lineOf(saved.id, manualItem!.id)).toMatchObject({ pendingQuantity: 0, stockQuantity: null });
    expect(await lineOf(saved.id, productItem!.id)).toMatchObject({ pendingQuantity: 1, stockQuantity: 1 });
    const db = (await getDb())!;
    const manualDeliveries = await db.select().from(quoteItemDeliveries).where(eq(quoteItemDeliveries.quoteItemId, manualItem!.id));
    expect(manualDeliveries).toEqual([expect.objectContaining({ productId: null, stockMovementId: null })]);
  }, 20_000);
});

describe("código de barras do catálogo", () => {
  it("salva o código informado no cadastro e recusa repetido", async () => {
    const barcode = `789${Date.now()}`.slice(0, 13);
    const id = await saveProduct({ shortDescription: `Com EAN ${Date.now()}`, unit: "UN", unitPrice: 1, active: true, barcode });
    productIds.push(id);
    const db = (await getDb())!;
    expect((await db.select().from(products).where(eq(products.id, id)))[0]).toMatchObject({ barcode });
    await expect(saveProduct({ shortDescription: "Outro", unit: "UN", unitPrice: 1, active: true, barcode })).rejects.toThrow(/já está no produto/);
    await saveProduct({ id, shortDescription: "Com EAN", unit: "UN", unitPrice: 1, active: true });
    expect((await db.select().from(products).where(eq(products.id, id)))[0]).toMatchObject({ barcode });
  });
});
