import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  financePayments,
  financeReceivables,
  products,
  quoteItemDeliveries,
  quoteItemReservations,
  quoteItems,
  quoteRooms,
  quotes,
  stockMovements,
} from "../drizzle/schema";
import { getDb } from "./db";
import { financeByQuote, recordFinancePayment } from "./financeDb";
import { createQuote, getPickingList, getQuote, saveProduct, saveQuote } from "./quoteDb";
import { approvedFulfillments, deliverQuoteItem, inventoryOverview, recordStockMovement } from "./stockDb";

let productId: number | null = null;
let quoteId: number | null = null;

async function removeValidationData() {
  const db = await getDb();
  if (!db) return;

  if (quoteId) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(eq(financeReceivables.quoteId, quoteId));
    const receivableIds = receivables.map((row) => row.id);
    if (receivableIds.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivableIds));
    await db.delete(financeReceivables).where(eq(financeReceivables.quoteId, quoteId));
    await db.delete(quoteItemDeliveries).where(eq(quoteItemDeliveries.quoteId, quoteId));
    await db.delete(quoteItemReservations).where(eq(quoteItemReservations.quoteId, quoteId));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(eq(quoteRooms.quoteId, quoteId));
    const roomIds = rooms.map((room) => room.id);
    if (roomIds.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds));
    await db.delete(quoteRooms).where(eq(quoteRooms.quoteId, quoteId));
    await db.delete(quotes).where(eq(quotes.id, quoteId));
  }
  if (productId) {
    await db.delete(stockMovements).where(eq(stockMovements.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
  }
  productId = null;
  quoteId = null;
}

describe("aprovação integrada de orçamento", () => {
  afterEach(removeValidationData);

  it("reserva estoque, permite entrega parcial e mantém parcelas e estornos rastreáveis", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    productId = await saveProduct({
      shortDescription: `Produto integrado ${suffix}`,
      fullDescription: "Descrição completa de validação para separação.",
      unit: "UN",
      supplierName: "Fornecedor de validação",
      unitPrice: 100,
      reorderPoint: 2,
      active: true,
    });
    await recordStockMovement({ productId, type: "entry", quantity: 10, responsible: "Teste integrado", occurredAt: new Date("2030-08-27T12:00:00.000Z") });

    const draft = await createQuote();
    quoteId = draft!.id;
    const saved = await saveQuote({
      id: draft!.id,
      quoteNumber: draft!.quoteNumber,
      clientName: `Cliente integrado ${suffix}`,
      professional: "Responsável de validação",
      status: "approved",
      issueDate: new Date("2030-08-27T12:00:00.000Z"),
      validUntil: new Date("2030-09-03T12:00:00.000Z"),
      discountMode: "percentage",
      discountValue: 0,
      shipping: 0,
      pixDiscountMode: "percentage",
      pixDiscountValue: 0,
      installments: 2,
      notes: "Validação integrada.",
      rooms: [{
        name: "AMBIENTE INTEGRADO",
        items: [{ productId, code: "QA", shortDescription: `Produto integrado ${suffix}`, unit: "UN", quantity: 10, unitPrice: 100 }],
      }],
    }, 0);

    expect(saved).toMatchObject({ id: quoteId, status: "approved" });
    const savedItem = saved!.rooms[0]!.items[0]!;
    const initialStock = (await inventoryOverview()).products.find((product) => product.id === productId);
    expect(initialStock).toMatchObject({ stockQuantity: 10, reservedQuantity: 10, availableQuantity: 0 });

    const picking = await getPickingList(quoteId!);
    expect(picking.items).toEqual([expect.objectContaining({ quantity: 10, fullDescription: "Descrição completa de validação para separação." })]);

    const fulfillment = (await approvedFulfillments()).find((item) => item.quoteId === quoteId);
    expect(fulfillment).toMatchObject({ quoteItemId: savedItem.id, pendingQuantity: 10, reservedQuantity: 10 });

    await expect(deliverQuoteItem({ quoteId: quoteId!, quoteItemId: savedItem.id, quantity: 7, responsible: "Expedição de teste", deliveredAt: new Date("2030-08-28T12:00:00.000Z") })).resolves.toMatchObject({ deliveredQuantity: 7, pendingQuantity: 3, stockQuantity: 3 });
    const residualStock = (await inventoryOverview()).products.find((product) => product.id === productId);
    expect(residualStock).toMatchObject({ stockQuantity: 3, reservedQuantity: 3, availableQuantity: 0 });

    const receivables = await financeByQuote(quoteId!);
    expect(receivables).toHaveLength(2);
    expect(receivables).toEqual(expect.arrayContaining([expect.objectContaining({ originalAmount: 500, remainingAmount: 500, status: "open" })]));

    await recordFinancePayment({ receivableId: receivables[0]!.id, type: "receipt", amount: 200, paymentMethod: "pix", paidAt: new Date("2030-08-28T12:00:00.000Z"), reference: "QA-REC", notes: "Recebimento de validação" }, 0);
    await expect(financeByQuote(quoteId!)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: receivables[0]!.id, receivedAmount: 200, remainingAmount: 300, status: "partial" })]));

    await recordFinancePayment({ receivableId: receivables[0]!.id, type: "reversal", amount: 200, paymentMethod: "pix", paidAt: new Date("2030-08-28T12:05:00.000Z"), reference: "QA-REV", notes: "Estorno de validação" }, 0);
    await expect(financeByQuote(quoteId!)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: receivables[0]!.id, receivedAmount: 0, remainingAmount: 500, status: "open" })]));
    await expect(getQuote(quoteId!)).resolves.toMatchObject({ id: quoteId, status: "approved" });
  });
});
