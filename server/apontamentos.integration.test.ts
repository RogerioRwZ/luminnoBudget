import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { afterSalesCases, financePayments, financeReceivables, products, quoteItemDeliveries, quoteItemReservations, quoteItems, quoteRooms, quotes, stockMovements, storeSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { canOpenPage } from "../shared/permissions";
import { buildWhatsAppProposal } from "../shared/whatsapp";
import { calculateQuote } from "../shared/quote";

const caller = (role: "admin" | "user" | "sales" | "stock" | "finance") => appRouter.createCaller({ user: { id: 999_010, role, name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1", socket: {} } as any, res: { clearCookie() {}, cookie() {} } as any });
const admin = caller("admin");
const productIds: number[] = [];
const quoteIds: number[] = [];

afterEach(async () => {
  const db = (await getDb())!;
  if (quoteIds.length) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    if (receivables.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
    await db.delete(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    await db.delete(afterSalesCases).where(inArray(afterSalesCases.quoteId, quoteIds));
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

const reference = () => `A-${Math.random().toString(36).slice(2, 10)}`;
async function product(stock = 0, costPrice: number | null = null) {
  const id = await admin.product.save({ reference: reference(), shortDescription: "Produto apontamentos", unit: "UN", unitPrice: 100, costPrice, reorderPoint: 0, active: true });
  productIds.push(id);
  if (stock) await admin.inventory.move({ productId: id, type: "entry", quantity: stock, occurredAt: new Date() });
  return id;
}
const draft = async (productId: number | null, over: Record<string, unknown> = {}, unit = "UN") => {
  const fresh = (await admin.quote.create())!;
  quoteIds.push(fresh.id);
  return { id: fresh.id, quoteNumber: fresh.quoteNumber, clientName: "Cliente", professional: "", status: "open" as const, issueDate: new Date(), validUntil: null, discountMode: "percentage" as const, discountValue: 0, shipping: 0, pixDiscountMode: "percentage" as const, pixDiscountValue: 0, installments: 1, notes: "", rooms: [{ name: "SALA", items: [{ productId, code: "X", shortDescription: "Item", unit, quantity: 2, unitPrice: 100 }] }], ...over };
};

describe("unidade e estoque", () => {
  it("recusa número como unidade no produto e limpa no item do orçamento", async () => {
    await expect(admin.product.save({ reference: reference(), shortDescription: "X", unit: "25", unitPrice: 1, reorderPoint: 0, active: true })).rejects.toThrow(/medida do produto/);
    const saved = (await admin.quote.save(await draft(null, {}, "380")))!;
    expect(saved.rooms[0]!.items[0]!.unit).toBe("UN");
  }, 20_000);

  it("entrada negativa é recusada; ajuste negativo continua valendo", async () => {
    const id = await product(5);
    await expect(admin.inventory.move({ productId: id, type: "entry", quantity: -2, occurredAt: new Date() })).rejects.toThrow(/positiva/);
    await expect(admin.inventory.move({ productId: id, type: "adjustment", quantity: -2, occurredAt: new Date() })).resolves.toMatchObject({ afterQuantity: 3 });
  }, 20_000);

  it("retirada não aceita data futura", async () => {
    const id = await product(2);
    const saved = (await admin.quote.save({ ...(await draft(id)), status: "approved" }))!;
    const quoteItemId = saved.rooms[0]!.items[0]!.id;
    await expect(admin.inventory.deliver({ quoteId: saved.id, quoteItemId, quantity: 1, deliveredAt: new Date(Date.now() + 86_400_000) })).rejects.toThrow(/futuro/);
    await expect(admin.inventory.deliver({ quoteId: saved.id, quoteItemId, quantity: 1, deliveredAt: new Date() })).resolves.toBeTruthy();
  }, 20_000);

  it("código de barras recusa valor inválido e referência de outro produto", async () => {
    const id = await product();
    const other = await product();
    const otherRef = (await admin.product.list()).find((row) => row.id === other)!.reference!;
    await expect(admin.product.setBarcode({ productId: id, barcode: "código" })).rejects.toThrow(/só aceita/);
    await expect(admin.product.setBarcode({ productId: id, barcode: otherRef })).rejects.toThrow(/referência do produto/);
  }, 20_000);
});

describe("erros", () => {
  it("regra de negócio é erro de quem pediu, não falha do servidor", async () => {
    await expect(admin.customers.save({ id: 999_999_999, name: "Inexistente" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/não encontrado/) });
    await expect(admin.product.archive({ id: 999_999_999 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("backup", () => {
  it("arquivo sem dados principais não apaga nada", async () => {
    const id = await product();
    await expect(admin.backup.import({ data: { format: "luminno-backup", version: 1, data: {} }, replace: true })).rejects.toThrow(/nada foi apagado/);
    expect((await admin.product.list()).some((row) => row.id === id)).toBe(true);
  }, 20_000);

  it("exportação traz comentários, versões, anexos, modelos e atividades", async () => {
    const backup = await admin.backup.export();
    for (const table of ["internalComments", "quoteVersions", "quoteAttachments", "messageTemplates", "activityLog"]) expect(backup.data).toHaveProperty(table);
  }, 20_000);
});

describe("pós-venda e financeiro", () => {
  it("reembolso não passa do total e aparece no Financeiro", async () => {
    const id = await product(2);
    const saved = (await admin.quote.save({ ...(await draft(id)), status: "approved" }))!;
    const quoteItemId = saved.rooms[0]!.items[0]!.id;
    await admin.inventory.deliver({ quoteId: saved.id, quoteItemId, quantity: 2, deliveredAt: new Date() });
    const created = (await admin.afterSales.create({ quoteId: saved.id, quoteItemId, type: "return", reason: "regret", quantity: 1, dueDate: new Date() }))!;
    await expect(admin.afterSales.update({ id: created.id, status: "resolved", dueDate: new Date(), resolution: "Devolvido", refundAmount: 99_999 })).rejects.toThrow(/total da venda/);
    await admin.afterSales.update({ id: created.id, status: "resolved", dueDate: new Date(), resolution: "Devolvido", refundAmount: 100 });
    expect((await admin.finance.overview()).refunds.find((row) => row.id === created.id)).toMatchObject({ amount: 100, quoteNumber: saved.quoteNumber });
  }, 30_000);
});

describe("limites de venda", () => {
  const settingsWith = async (values: { maxDiscountPercent: string; minMarginPercent: string }) => {
    const db = (await getDb())!;
    await admin.settings.get();
    await db.update(storeSettings).set(values).where(eq(storeSettings.id, 1));
  };
  afterEach(() => settingsWith({ maxDiscountPercent: "0.00", minMarginPercent: "0.00" }));

  it("Vendas não aprova acima do desconto nem abaixo da margem; outro perfil aprova", async () => {
    await settingsWith({ maxDiscountPercent: "10.00", minMarginPercent: "0.00" });
    const discounted = await draft(null, { discountValue: 50 });
    await expect(caller("sales").quote.save({ ...discounted, status: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/limite de 10%/) });
    await expect(caller("sales").quote.save({ ...discounted, status: "open" })).resolves.toBeTruthy();
    await expect(caller("user").quote.save({ ...discounted, status: "approved" })).resolves.toMatchObject({ status: "approved" });

    await settingsWith({ maxDiscountPercent: "0.00", minMarginPercent: "50.00" });
    const id = await product(0, 90);
    const low = await draft(id);
    await expect(caller("sales").quote.save({ ...low, status: "approved" })).rejects.toThrow(/margem mínima/);
  }, 30_000);
});

describe("o que cada perfil recebe", () => {
  it("Expedição não recebe clientes, orçamentos completos nem valores do painel", async () => {
    const stock = caller("stock");
    await expect(stock.customers.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(stock.quote.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const options = await stock.quote.options();
    expect(options[0] ?? { id: 1 }).not.toHaveProperty("rooms");
    expect(await stock.dashboard()).toMatchObject({ approvedRevenue: 0, approvedValue: 0, finance: null });
  }, 20_000);

  it("Administração só abre para administrador", () => {
    expect(canOpenPage("admin", "/administracao")).toBe(true);
    for (const role of ["user", "sales", "stock", "finance"]) expect(canOpenPage(role, "/administracao")).toBe(false);
  });
});

describe("WhatsApp", () => {
  it("quantidade com vírgula", () => {
    const summary = calculateQuote({ rooms: [{ items: [{ quantity: 2.5, unitPrice: 10 }] }], discountMode: "percentage", discountValue: 0, shipping: 0, pixDiscountMode: "percentage", pixDiscountValue: 0, installments: 1 });
    const text = buildWhatsAppProposal({ brand: "Loja", quoteNumber: 1, clientName: "C", rooms: [{ name: "SALA", items: [{ quantity: 2.5, shortDescription: "Fita", unitPrice: 10 }] }], summary, installments: 1 });
    expect(text).toContain("2,5x Fita");
  });
});
