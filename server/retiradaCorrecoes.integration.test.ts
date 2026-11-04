import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { afterSalesCases, financePayments, financeReceivables, internalComments, products, quoteItemCancellations, quoteItemDeliveries, quoteItemReservations, quoteItems, quoteRooms, quotes, quoteVersions, stockLoanItems, stockLoans, stockMovements } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { calculateReceivableStatus } from "../shared/finance";
import { warrantyLots } from "../shared/afterSales";

const admin = appRouter.createCaller({ user: { id: 999_009, role: "admin", name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1", socket: {} } as any, res: { clearCookie() {}, cookie() {} } as any });

const productIds: number[] = [];
const quoteIds: number[] = [];
const loanIds: number[] = [];

afterEach(async () => {
  const db = (await getDb())!;
  if (quoteIds.length) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    if (receivables.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
    await db.delete(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    await db.delete(afterSalesCases).where(inArray(afterSalesCases.quoteId, quoteIds));
    await db.delete(quoteItemDeliveries).where(inArray(quoteItemDeliveries.quoteId, quoteIds));
    await db.delete(quoteItemCancellations).where(inArray(quoteItemCancellations.quoteId, quoteIds));
    await db.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteId, quoteIds));
    await db.delete(internalComments).where(inArray(internalComments.quoteId, quoteIds));
    await db.delete(quoteVersions).where(inArray(quoteVersions.quoteId, quoteIds));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds));
    if (rooms.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id)));
    await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds));
    await db.delete(quotes).where(inArray(quotes.id, quoteIds));
  }
  if (loanIds.length) {
    await db.delete(stockLoanItems).where(inArray(stockLoanItems.loanId, loanIds));
    await db.delete(stockLoans).where(inArray(stockLoans.id, loanIds));
  }
  if (productIds.length) {
    await db.delete(stockMovements).where(inArray(stockMovements.productId, productIds));
    await db.delete(products).where(inArray(products.id, productIds));
  }
  productIds.length = 0;
  quoteIds.length = 0;
  loanIds.length = 0;
});

async function product(stock: number, warrantyMonths: number | null = null) {
  const id = await admin.product.save({ reference: `C-${Math.random().toString(36).slice(2, 10)}`, shortDescription: "Produto correções", unit: "UN", unitPrice: 10, reorderPoint: 0, warrantyMonths, active: true });
  productIds.push(id);
  if (stock) await admin.inventory.move({ productId: id, type: "entry", quantity: stock, occurredAt: new Date() });
  return id;
}

async function quote(items: Array<{ productId: number | null; quantity: number }>, status: "approved" | "open" = "approved") {
  const fresh = (await admin.quote.create())!;
  quoteIds.push(fresh.id);
  const input = { id: fresh.id, quoteNumber: fresh.quoteNumber, clientName: "Cliente correções", professional: "", status, issueDate: new Date(), validUntil: null, discountMode: "percentage" as const, discountValue: 0, shipping: 0, pixDiscountMode: "percentage" as const, pixDiscountValue: 0, installments: 1, notes: "", rooms: [{ name: "SALA", items: items.map((item) => ({ productId: item.productId, code: item.productId ? `P${item.productId}` : "AV", shortDescription: "Item", unit: "UN", quantity: item.quantity, unitPrice: 10 })) }] };
  const saved = (await admin.quote.save(input))!;
  return { input, id: saved.id, items: saved.rooms[0]!.items };
}

const lineOf = async (quoteId: number, itemId: number) => (await admin.inventory.fulfillments()).find((line) => line.quoteItemId === itemId)!;
const stockOf = async (productId: number) => (await admin.inventory.overview()).products.find((row) => row.id === productId)!;
const deliver = (quoteId: number, quoteItemId: number, quantity: number, deliveredAt = new Date()) => admin.inventory.deliver({ quoteId, quoteItemId, quantity, deliveredAt });
const openCase = (quoteId: number, quoteItemId: number, type: "return" | "exchange" | "warranty", quantity: number) => admin.afterSales.create({ quoteId, quoteItemId, type, reason: "defect", quantity, dueDate: new Date(Date.now() + 86_400_000) });
const accepted = (results: PromiseSettledResult<unknown>[]) => results.filter((result) => result.status === "fulfilled").length;

describe("cancelar saldo", () => {
  it("tira o saldo das retiradas, libera a reserva para a fila e pode ser desfeito", async () => {
    const productId = await product(10);
    const first = await quote([{ productId, quantity: 10 }]);
    const waiting = await quote([{ productId, quantity: 3 }]);
    await deliver(first.id, first.items[0]!.id, 4);

    await expect(admin.inventory.cancelRemainder({ quoteId: first.id, lines: [{ quoteItemId: first.items[0]!.id, quantity: 7 }], reason: "Desistiu" })).rejects.toThrow(/excede o saldo/);
    await expect(admin.inventory.cancelRemainder({ quoteId: first.id, lines: [{ quoteItemId: first.items[0]!.id, quantity: 1 }], reason: "x" })).rejects.toThrow();
    const result = await admin.inventory.cancelRemainder({ quoteId: first.id, lines: [{ quoteItemId: first.items[0]!.id, quantity: 5 }], reason: "Desistiu" });
    expect(result.amount).toBe(50);

    expect(await lineOf(first.id, first.items[0]!.id)).toMatchObject({ deliveredQuantity: 4, cancelledQuantity: 5, pendingQuantity: 1, reservedQuantity: 1 });
    expect(await lineOf(waiting.id, waiting.items[0]!.id)).toMatchObject({ reservedQuantity: 3, shortageQuantity: 0 });
    await expect(deliver(first.id, first.items[0]!.id, 2)).rejects.toThrow(/excede/);
    expect((await admin.inventory.picking({ quoteId: first.id })).items[0]).toMatchObject({ quantity: 1, orderedQuantity: 5 });
    expect((await admin.inventory.purchases()).flatMap((group) => group.lines).find((line) => line.productId === productId)).toBeUndefined();

    const cancellation = (await lineOf(first.id, first.items[0]!.id)).cancellations[0]!;
    await admin.inventory.undoCancellation({ id: cancellation.id });
    expect(await lineOf(first.id, first.items[0]!.id)).toMatchObject({ cancelledQuantity: 0, pendingQuantity: 6, reservedQuantity: 3, shortageQuantity: 3 });
    await expect(admin.inventory.undoCancellation({ id: cancellation.id })).rejects.toThrow(/já foi desfeito/);
  }, 30_000);

  it("orçamento só com saldo cancelado ainda pode ser reaberto", async () => {
    const productId = await product(2);
    const sale = await quote([{ productId, quantity: 2 }]);
    await admin.inventory.cancelRemainder({ quoteId: sale.id, lines: [{ quoteItemId: sale.items[0]!.id, quantity: 2 }], reason: "Desistiu" });
    expect((await admin.quote.lockInfo({ id: sale.id })).canReopen).toBe(true);
    await expect(admin.quote.save({ ...sale.input, status: "open" })).resolves.toMatchObject({ status: "open" });
    const db = (await getDb())!;
    expect(await db.select().from(quoteItemCancellations).where(eq(quoteItemCancellations.quoteId, sale.id))).toEqual([]);
  }, 30_000);
});

describe("estornar retirada", () => {
  it("devolve ao estoque, volta a pendente, refaz a reserva e guarda o histórico", async () => {
    const productId = await product(5);
    const sale = await quote([{ productId, quantity: 5 }]);
    const itemId = sale.items[0]!.id;
    const { deliveryId } = await deliver(sale.id, itemId, 3);
    expect((await admin.quote.lockInfo({ id: sale.id })).canReopen).toBe(false);

    await admin.inventory.reverseDelivery({ deliveryId, reason: "Lançada errada" });
    expect(await lineOf(sale.id, itemId)).toMatchObject({ deliveredQuantity: 0, pendingQuantity: 5, reservedQuantity: 5, stockQuantity: 5 });
    expect((await lineOf(sale.id, itemId)).deliveries[0]).toMatchObject({ id: deliveryId, reversalReason: "Lançada errada" });
    await expect(admin.inventory.reverseDelivery({ deliveryId, reason: "De novo" })).rejects.toThrow(/já foi estornada/);

    const results = await Promise.allSettled([1, 2, 3].map(async () => {
      const { deliveryId: next } = await deliver(sale.id, itemId, 1);
      return admin.inventory.reverseDelivery({ deliveryId: next, reason: "Ida e volta" });
    }));
    expect(accepted(results)).toBe(3);
    expect((await stockOf(productId)).stockQuantity).toBe(5);

    // Só com retiradas estornadas, o orçamento volta a poder ser reaberto.
    expect((await admin.quote.lockInfo({ id: sale.id })).canReopen).toBe(true);
    await expect(admin.quote.save({ ...sale.input, status: "open" })).resolves.toMatchObject({ status: "open" });
  }, 30_000);

  it("item avulso volta a pendente; o que está em ocorrência não estorna", async () => {
    const productId = await product(2);
    const sale = await quote([{ productId: null, quantity: 1 }, { productId, quantity: 2 }]);
    const manual = await deliver(sale.id, sale.items[0]!.id, 1);
    await admin.inventory.reverseDelivery({ deliveryId: manual.deliveryId, reason: "Lançada errada" });
    expect(await lineOf(sale.id, sale.items[0]!.id)).toMatchObject({ deliveredQuantity: 0, pendingQuantity: 1 });

    const { deliveryId } = await deliver(sale.id, sale.items[1]!.id, 2);
    await openCase(sale.id, sale.items[1]!.id, "return", 1);
    await expect(admin.inventory.reverseDelivery({ deliveryId, reason: "Lançada errada" })).rejects.toThrow(/pós-venda/);
  }, 30_000);
});

describe("pós-venda limitado ao retirado", () => {
  it("só abre ocorrência do que o cliente já levou", async () => {
    const productId = await product(10);
    const sale = await quote([{ productId, quantity: 10 }]);
    const itemId = sale.items[0]!.id;
    await expect(openCase(sale.id, itemId, "return", 1)).rejects.toThrow(/ainda não foi retirado/);
    await deliver(sale.id, itemId, 2);
    expect((await admin.afterSales.items({ quoteId: sale.id })).items[0]).toMatchObject({ quantity: 10, delivered: 2, available: 2 });
    await expect(openCase(sale.id, itemId, "return", 3)).rejects.toThrow(/Só 2/);
    const created = (await openCase(sale.id, itemId, "return", 2))!;
    await admin.afterSales.update({ id: created.id, status: "resolved", dueDate: new Date(), resolution: "Voltou", restock: true });
    expect((await stockOf(productId)).stockQuantity).toBe(10);
  }, 30_000);
});

describe("recusar ou reabrir ocorrência", () => {
  it("desfaz a devolução e impede a mesma peça de voltar duas vezes", async () => {
    const productId = await product(5);
    const sale = await quote([{ productId, quantity: 5 }]);
    await deliver(sale.id, sale.items[0]!.id, 5);
    const first = (await openCase(sale.id, sale.items[0]!.id, "return", 5))!;
    await admin.afterSales.update({ id: first.id, status: "resolved", dueDate: new Date(), resolution: "Voltou", restock: true });
    expect((await stockOf(productId)).stockQuantity).toBe(5);
    await admin.afterSales.update({ id: first.id, status: "rejected", dueDate: new Date(), resolution: "Foi engano" });
    expect((await stockOf(productId)).stockQuantity).toBe(0);
    const second = (await openCase(sale.id, sale.items[0]!.id, "return", 5))!;
    await admin.afterSales.update({ id: second.id, status: "resolved", dueDate: new Date(), resolution: "Voltou", restock: true });
    expect((await stockOf(productId)).stockQuantity).toBe(5);
  }, 30_000);

  it("desfaz a baixa da peça nova ao reabrir; recusa se a devolvida já foi vendida", async () => {
    const productId = await product(4);
    const sale = await quote([{ productId, quantity: 2 }]);
    await deliver(sale.id, sale.items[0]!.id, 2);
    const created = (await openCase(sale.id, sale.items[0]!.id, "exchange", 2))!;
    await admin.afterSales.update({ id: created.id, status: "resolved", dueDate: new Date(), resolution: "Trocada", replacement: true });
    expect((await stockOf(productId)).stockQuantity).toBe(0);
    await admin.afterSales.update({ id: created.id, status: "open", dueDate: new Date() });
    expect((await stockOf(productId)).stockQuantity).toBe(2);
    await admin.afterSales.update({ id: created.id, status: "resolved", dueDate: new Date(), resolution: "Devolvida", restock: true });
    expect((await stockOf(productId)).stockQuantity).toBe(4);
    await quote([{ productId, quantity: 4 }]);
    await expect(admin.afterSales.update({ id: created.id, status: "rejected", dueDate: new Date(), resolution: "Engano" })).rejects.toThrow(/Não dá para desfazer/);
    expect((await admin.afterSales.list({ quoteId: sale.id }))[0]).toMatchObject({ status: "resolved" });
  }, 30_000);
});

describe("operações simultâneas", () => {
  it("retirada: só passa o que cabe no pedido", async () => {
    const productId = await product(5);
    const sale = await quote([{ productId, quantity: 5 }]);
    const results = await Promise.allSettled([1, 2, 3].map(() => deliver(sale.id, sale.items[0]!.id, 5)));
    expect(accepted(results)).toBe(1);
    expect(await lineOf(sale.id, sale.items[0]!.id)).toMatchObject({ deliveredQuantity: 5, stockQuantity: 0 });
  }, 30_000);

  it("retiradas parciais simultâneas fecham a conta", async () => {
    const productId = await product(6);
    const sale = await quote([{ productId, quantity: 6 }]);
    await Promise.all([1, 2, 3].map(() => deliver(sale.id, sale.items[0]!.id, 2)));
    expect(await lineOf(sale.id, sale.items[0]!.id)).toMatchObject({ deliveredQuantity: 6, reservedQuantity: 0, stockQuantity: 0 });
  }, 30_000);

  it("item avulso não entrega a mais", async () => {
    const sale = await quote([{ productId: null, quantity: 1 }]);
    const results = await Promise.allSettled([1, 2, 3].map(() => deliver(sale.id, sale.items[0]!.id, 1)));
    expect(accepted(results)).toBe(1);
  }, 30_000);

  it("aprovações não reservam mais do que há em estoque", async () => {
    const productId = await product(5);
    const drafts = await Promise.all([1, 2, 3, 4].map(() => quote([{ productId, quantity: 3 }], "open")));
    await Promise.allSettled(drafts.map((draft) => admin.quote.save({ ...draft.input, status: "approved" })));
    const row = await stockOf(productId);
    expect(row.reservedQuantity).toBeLessThanOrEqual(row.stockQuantity);
    expect(row.reservedQuantity).toBe(5);
  }, 30_000);

  it("pós-venda: uma ocorrência e uma devolução ao estoque", async () => {
    const productId = await product(5);
    const sale = await quote([{ productId, quantity: 5 }]);
    await deliver(sale.id, sale.items[0]!.id, 5);
    const results = await Promise.allSettled([1, 2, 3].map(() => openCase(sale.id, sale.items[0]!.id, "return", 5)));
    expect(accepted(results)).toBe(1);
    const created = (results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ id: number }>).value;
    await Promise.allSettled([1, 2, 3].map(() => admin.afterSales.update({ id: created.id, status: "resolved", dueDate: new Date(), resolution: "Voltou", restock: true })));
    expect((await stockOf(productId)).stockQuantity).toBe(5);
  }, 30_000);

  it("acerto de empréstimo não devolve em dobro", async () => {
    const productId = await product(5);
    const loan = await admin.loans.create({ borrowerName: "Paralelo", borrowerKind: "client", dueDate: new Date(), items: [{ productId, quantity: 2 }] });
    loanIds.push(loan.id);
    const results = await Promise.allSettled([1, 2, 3].map(() => admin.loans.settle({ loanId: loan.id, lines: [{ itemId: loan.items[0]!.id, returned: 2, sold: 0, lost: 0 }] })));
    expect(accepted(results)).toBe(1);
    expect((await stockOf(productId)).stockQuantity).toBe(5);
  }, 30_000);
});

describe("garantia por retirada", () => {
  it("cada retirada tem o próprio prazo", () => {
    const now = new Date(2026, 10, 4);
    const { lots, delivered, underWarrantyQuantity } = warrantyLots([{ quantity: 3, deliveredAt: new Date(2026, 10, 3) }, { quantity: 4, deliveredAt: new Date(2026, 0, 10) }], 6, now);
    expect(delivered).toBe(7);
    expect(underWarrantyQuantity).toBe(3);
    expect(lots.map((lot) => lot.underWarranty)).toEqual([false, true]);
    expect(lots[1]!.warrantyUntil).toEqual(new Date(2027, 4, 3));
  });

  it("peça retirada depois não herda o prazo da primeira", async () => {
    const productId = await product(5, 6);
    const sale = await quote([{ productId, quantity: 5 }]);
    await deliver(sale.id, sale.items[0]!.id, 2, new Date(Date.now() - 300 * 86_400_000));
    await deliver(sale.id, sale.items[0]!.id, 1);
    expect((await admin.afterSales.items({ quoteId: sale.id })).items[0]).toMatchObject({ delivered: 3, underWarrantyQuantity: 1 });
  }, 30_000);
});

describe("restaurar versão", () => {
  it("volta os valores guardados", async () => {
    const productId = await product(0);
    const sale = await quote([{ productId, quantity: 2 }], "open");
    await admin.quote.createVersion({ quoteId: sale.id, changeNote: "Original" });
    const [version] = await admin.quote.versions({ quoteId: sale.id });
    await admin.quote.save({ ...sale.input, shipping: 999 });
    await admin.quote.restoreVersion({ versionId: version!.id, comment: "Cliente pediu voltar" });
    const restored = (await admin.quote.get({ id: sale.id }))!;
    expect(Number(restored.shipping)).toBe(0);
    expect(Number(restored.rooms[0]!.items[0]!.quantity)).toBe(2);
    expect(restored.status).toBe("open");
  }, 30_000);
});

describe("vencimento", () => {
  const base = { originalAmount: 100, receivedAmount: 0, cancelled: false };
  it("vence no fim do dia, no horário de Brasília", () => {
    const now = new Date("2026-11-04T23:00:00Z"); // 20h em Brasília
    expect(calculateReceivableStatus({ ...base, dueDate: new Date("2026-11-04T03:00:00Z"), now })).toBe("open");
    expect(calculateReceivableStatus({ ...base, dueDate: new Date("2026-11-04T15:00:00Z"), now })).toBe("open");
    expect(calculateReceivableStatus({ ...base, dueDate: new Date("2026-11-04T02:59:00Z"), now })).toBe("overdue");
    expect(calculateReceivableStatus({ ...base, dueDate: new Date("2026-11-05T01:00:00Z"), now: new Date("2026-11-05T02:00:00Z") })).toBe("open");
  });

  it("venda recém-aprovada não nasce vencida", async () => {
    const sale = await quote([{ productId: null, quantity: 1 }]);
    const receivables = await admin.finance.byQuote({ quoteId: sale.id });
    expect((receivables as Array<{ status: string }>).every((row) => row.status === "open")).toBe(true);
  }, 30_000);
});
