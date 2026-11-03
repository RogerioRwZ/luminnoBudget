import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { afterSalesCases, financePayments, financeReceivables, products, quoteItemDeliveries, quoteItemReservations, quoteItems, quoteRooms, quotes, stockMovements } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const caller = (role: "sales" | "stock" | "finance" | "user") =>
  appRouter.createCaller({ user: { id: 999_003, role, name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });

const created = { productId: 0, quoteId: 0 };
afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (created.quoteId) {
    await db.delete(afterSalesCases).where(eq(afterSalesCases.quoteId, created.quoteId));
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(eq(financeReceivables.quoteId, created.quoteId));
    if (receivables.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
    await db.delete(financeReceivables).where(eq(financeReceivables.quoteId, created.quoteId));
    await db.delete(quoteItemDeliveries).where(eq(quoteItemDeliveries.quoteId, created.quoteId));
    await db.delete(quoteItemReservations).where(eq(quoteItemReservations.quoteId, created.quoteId));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(eq(quoteRooms.quoteId, created.quoteId));
    if (rooms.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id)));
    await db.delete(quoteRooms).where(eq(quoteRooms.quoteId, created.quoteId));
    await db.delete(quotes).where(eq(quotes.id, created.quoteId));
  }
  if (created.productId) {
    await db.delete(stockMovements).where(eq(stockMovements.productId, created.productId));
    await db.delete(products).where(eq(products.id, created.productId));
  }
  Object.assign(created, { productId: 0, quoteId: 0 });
});

const stockOf = async (productId: number) => {
  const db = (await getDb())!;
  return Number((await db.select({ stock: products.stockQuantity }).from(products).where(eq(products.id, productId)))[0]!.stock);
};

describe("pós-venda", () => {
  it("abre, limita a quantidade, resolve com estoque e entra no relatório", async () => {
    const stamp = Date.now();
    const admin = caller("user");
    created.productId = await admin.product.save({ reference: `T-${Math.random().toString(36).slice(2, 10)}`, shortDescription: `Spot pós-venda ${stamp}`, unit: "UN", supplierName: "Fornecedor PV", unitPrice: 50, reorderPoint: 0, warrantyMonths: 24, active: true });
    await admin.inventory.move({ productId: created.productId, type: "entry", quantity: 10, occurredAt: new Date() });

    const quote = (await admin.quote.create())!;
    created.quoteId = quote.id;
    // Antes de aprovar, não há pós-venda.
    await expect(admin.afterSales.items({ quoteId: quote.id })).rejects.toThrow(/aprovados/);
    await admin.quote.save({
      id: quote.id, clientName: "Cliente PV", status: "approved", issueDate: new Date(),
      discountMode: "percentage", discountValue: 0, shipping: 0, pixDiscountMode: "percentage", pixDiscountValue: 0, installments: 1,
      rooms: [{ name: "Sala", items: [{ productId: created.productId, code: "PV", shortDescription: `Spot pós-venda ${stamp}`, unit: "UN", quantity: 3, unitPrice: 50 }] }],
    });
    await admin.inventory.deliverAll({ quoteId: quote.id, deliveredAt: new Date() });
    expect(await stockOf(created.productId)).toBe(7);

    const { items } = await admin.afterSales.items({ quoteId: quote.id });
    const item = items[0]!;
    expect(item).toMatchObject({ quantity: 3, available: 3, warrantyMonths: 24, underWarranty: true });
    expect(item.deliveredAt).toBeInstanceOf(Date);
    expect(item.warrantyUntil!.getFullYear()).toBe(item.deliveredAt!.getFullYear() + 2);

    // Vendas e expedição também abrem ocorrências.
    const today = new Date();
    const opened = await caller("sales").afterSales.create({ quoteId: quote.id, quoteItemId: item.quoteItemId, type: "exchange", reason: "defect", quantity: 2, dueDate: today, description: "Piscando" });
    expect(opened).toMatchObject({ clientName: "Cliente PV", supplierName: "Fornecedor PV", status: "open", quantity: 2, quoteNumber: quote.quoteNumber });
    await expect(caller("stock").afterSales.create({ quoteId: quote.id, quoteItemId: item.quoteItemId, type: "return", reason: "regret", quantity: 2, dueDate: today })).rejects.toThrow(/Só 1 UN/);
    expect((await admin.afterSales.items({ quoteId: quote.id })).items[0]!.available).toBe(1);

    // Com prazo hoje, aparece no Resumo do dia de quem tem a área.
    const summary = await caller("stock").summary.today();
    expect(summary.afterSales?.items.some((row) => row.id === opened.id)).toBe(true);
    expect(summary.backup).toBeNull();

    // Resolver exige a solução; garantia não volta ao estoque.
    await expect(admin.afterSales.update({ id: opened.id, status: "resolved", dueDate: today })).rejects.toThrow(/como a ocorrência foi resolvida/);

    // Troca resolvida: a peça devolvida volta e a peça nova sai do estoque.
    const resolved = await admin.afterSales.update({ id: opened.id, status: "resolved", dueDate: today, resolution: "Trocadas na loja", restock: true, replacement: true, responsible: "João" });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.restockMovementId).toBeTruthy();
    expect(resolved.replacementMovementId).toBeTruthy();
    expect(await stockOf(created.productId)).toBe(7);
    const db = (await getDb())!;
    const movements = await db.select().from(stockMovements).where(eq(stockMovements.productId, created.productId));
    expect(movements.filter((row) => row.notes?.startsWith(`Pós-venda #${opened.id}`)).map((row) => Number(row.quantity)).sort()).toEqual([-2, 2]);

    // Salvar de novo não repete as movimentações.
    await admin.afterSales.update({ id: opened.id, status: "resolved", dueDate: today, resolution: "Trocadas na loja", restock: true, replacement: true });
    expect((await db.select().from(stockMovements).where(eq(stockMovements.productId, created.productId))).length).toBe(movements.length);

    const warranty = await admin.afterSales.create({ quoteId: quote.id, quoteItemId: item.quoteItemId, type: "warranty", reason: "defect", quantity: 1, dueDate: today });
    await expect(admin.afterSales.update({ id: warranty.id, status: "resolved", dueDate: today, resolution: "Fornecedor trocou", restock: true })).rejects.toThrow(/garantia/i);
    await admin.afterSales.update({ id: warranty.id, status: "rejected", dueDate: today, resolution: "Mau uso" });
    // Recusada devolve a quantidade para novas ocorrências.
    expect((await admin.afterSales.items({ quoteId: quote.id })).items[0]!.available).toBe(1);

    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const report = await admin.afterSales.report({ from, to: new Date(from.getTime() + 24 * 60 * 60_000) });
    const row = report.byProduct.find((entry) => entry.productId === created.productId)!;
    expect(row).toMatchObject({ cases: 2, quantity: 3, sold: 3, rate: 100, supplierName: "Fornecedor PV" });
    expect(report.totals).toMatchObject({ resolved: expect.any(Number), rejected: expect.any(Number) });

    const list = await admin.afterSales.list({ quoteId: quote.id });
    expect(list.map((entry) => entry.status).sort()).toEqual(["rejected", "resolved"]);

    // Sem as cobranças (que já bloqueiam), quem impede a exclusão é o pós-venda.
    await db.delete(financeReceivables).where(eq(financeReceivables.quoteId, quote.id));
    await expect(admin.quote.delete({ id: quote.id })).rejects.toThrow(/pós-venda/);
  });

  it("impede tirar de Aprovado um orçamento com pós-venda", async () => {
    const admin = caller("user");
    created.productId = await admin.product.save({ reference: `T-${Math.random().toString(36).slice(2, 10)}`, shortDescription: `Fita pós-venda ${Date.now()}`, unit: "UN", unitPrice: 30, reorderPoint: 0, active: true });
    const quote = (await admin.quote.create())!;
    created.quoteId = quote.id;
    const draft = {
      id: quote.id, clientName: "Cliente PV 2", status: "approved" as const, issueDate: new Date(),
      discountMode: "percentage" as const, discountValue: 0, shipping: 0, pixDiscountMode: "percentage" as const, pixDiscountValue: 0, installments: 1,
      rooms: [{ name: "Sala", items: [{ productId: created.productId, code: "F", shortDescription: "Fita", unit: "UN", quantity: 2, unitPrice: 30 }] }],
    };
    await admin.quote.save(draft);
    const item = (await admin.afterSales.items({ quoteId: quote.id })).items[0]!;
    await admin.afterSales.create({ quoteId: quote.id, quoteItemId: item.quoteItemId, type: "return", reason: "regret", quantity: 1, dueDate: new Date() });

    await expect(admin.quote.save({ ...draft, status: "open" })).rejects.toThrow(/pós-venda/);
    // Continua aprovado e com o mesmo item.
    expect((await admin.afterSales.items({ quoteId: quote.id })).items[0]!.quoteItemId).toBe(item.quoteItemId);
    // Dados do cliente seguem editáveis.
    const renamed = await admin.quote.save({ ...draft, clientName: "Cliente PV 2 (novo nome)" });
    expect(renamed?.clientName).toBe("Cliente PV 2 (novo nome)");
  });
});
