import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { commissionPayments, financePayments, financeReceivables, products, professionals, quoteItemReservations, quoteItems, quoteRooms, quotes } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const caller = (role: "sales" | "stock" | "finance" | "user") =>
  appRouter.createCaller({ user: { id: 999_002, role, name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });

const created = { productId: 0, quoteId: 0, professional: "" };
afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (created.quoteId) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(eq(financeReceivables.quoteId, created.quoteId));
    if (receivables.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
    await db.delete(financeReceivables).where(eq(financeReceivables.quoteId, created.quoteId));
    await db.delete(quoteItemReservations).where(eq(quoteItemReservations.quoteId, created.quoteId));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(eq(quoteRooms.quoteId, created.quoteId));
    if (rooms.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id)));
    await db.delete(quoteRooms).where(eq(quoteRooms.quoteId, created.quoteId));
    await db.delete(quotes).where(eq(quotes.id, created.quoteId));
  }
  if (created.productId) await db.delete(products).where(eq(products.id, created.productId));
  if (created.professional) {
    await db.delete(professionals).where(eq(professionals.name, created.professional));
    await db.delete(commissionPayments).where(eq(commissionPayments.professional, created.professional));
  }
  Object.assign(created, { productId: 0, quoteId: 0, professional: "" });
});

describe("custo, margem, comissão e relatórios", () => {
  it("esconde o custo do perfil Vendas e fixa custo e comissão na venda", async () => {
    const stamp = Date.now();
    const admin = caller("user");
    const sales = caller("sales");
    created.productId = await admin.product.save({ reference: `T-${stamp}`, shortDescription: `Pendente custo ${stamp}`, unit: "UN", unitPrice: 100, costPrice: 40, reorderPoint: 0, active: true });

    const forSales = (await sales.product.list({ search: `Pendente custo ${stamp}` }))[0]!;
    expect(forSales).not.toHaveProperty("costPrice");
    expect((await admin.product.list({ search: `Pendente custo ${stamp}` }))[0]).toMatchObject({ costPrice: "40.00" });

    // Vendas edita o produto, mas o custo não muda.
    await sales.product.save({ id: created.productId, reference: `T-${stamp}`, shortDescription: `Pendente custo ${stamp}`, unit: "UN", unitPrice: 110, costPrice: 1, reorderPoint: 0, active: true });
    expect((await admin.product.list({ search: `Pendente custo ${stamp}` }))[0]).toMatchObject({ costPrice: "40.00", unitPrice: "110.00" });

    created.professional = `Arq. Teste ${stamp}`;
    await admin.commissions.saveProfessional({ name: created.professional, commissionPercent: 5, phone: null });

    const quote = (await admin.quote.create())!;
    created.quoteId = quote.id;
    expect(quote.sellerUserId).toBe(999_002);
    const draft = {
      id: quote.id, clientName: "Cliente relatório", professional: `  arq. teste ${stamp} `, status: "approved" as const, issueDate: new Date(),
      discountMode: "percentage" as const, discountValue: 10, shipping: 20, pixDiscountMode: "percentage" as const, pixDiscountValue: 0, installments: 2,
      rooms: [{ name: "Sala", items: [{ productId: created.productId, code: "X", shortDescription: "Pendente", unit: "UN", quantity: 2, unitPrice: 100 }] }],
    };
    const saved = (await admin.quote.save(draft))!;
    expect(saved.commissionPercent).toBe("5.00");
    expect(saved.rooms[0]!.items[0]!.unitCost).toBe("40.00");
    expect(saved.summary.total).toBe(200);

    const seenBySales = (await sales.quote.get({ id: quote.id }))!;
    expect(seenBySales.rooms[0]!.items[0]).not.toHaveProperty("unitCost");

    // Mudar o percentual depois não altera a venda já aprovada.
    await admin.commissions.saveProfessional({ name: created.professional, commissionPercent: 10, phone: null });
    expect((await admin.quote.save({ ...draft, clientName: "Cliente relatório 2" }))!.commissionPercent).toBe("5.00");

    const receivable = (await admin.finance.byQuote({ quoteId: quote.id }))[0]!;
    await admin.finance.recordPayment({ receivableId: receivable.id, type: "receipt", amount: 100, paymentMethod: "pix", paidAt: new Date() });

    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const commission = await caller("finance").commissions.overview(range);
    const row = commission.professionals.find((entry) => entry.name === created.professional)!;
    // Recebido 100 de um total de 200 com 20 de frete: base 90, comissão 5% = 4,50.
    expect(row).toMatchObject({ soldInPeriod: 200, receivedInPeriod: 100, commissionInPeriod: 4.5, earnedTotal: 4.5, balance: 4.5, currentPercent: 10 });
    await admin.commissions.pay({ professional: created.professional, amount: 4.5, paidAt: new Date() });
    expect((await admin.commissions.overview(range)).professionals.find((entry) => entry.name === created.professional)).toMatchObject({ paidInPeriod: 4.5, balance: 0 });

    const report = await caller("finance").reports.sales(range);
    const line = report.byProfessional.find((entry) => entry.label.trim().toLowerCase() === created.professional.toLowerCase())!;
    // 2 × 100 com 10% de desconto = 180 de mercadoria; custo 2 × 40 = 80.
    expect(line).toMatchObject({ quotes: 1, quantity: 2, revenue: 180, cost: 80, profit: 100 });
    expect(line.margin).toBeCloseTo(100 / 180, 5);
    await expect(sales.reports.sales(range)).rejects.toThrow(/não tem acesso/);
  }, 30_000);

  it("monta o resumo do dia só com as áreas do perfil", async () => {
    const stock = await caller("stock").summary.today();
    expect(stock.followUps).toBeNull();
    expect(stock.installments).toBeNull();
    expect(stock.purchases).not.toBeNull();
    expect(stock.deliveries).not.toBeNull();
    const sales = await caller("sales").summary.today();
    expect(sales.followUps).not.toBeNull();
    expect(sales.installments).toBeNull();
    expect(sales.purchases).toBeNull();
    expect((await caller("finance").summary.today()).installments).not.toBeNull();
  });
});
