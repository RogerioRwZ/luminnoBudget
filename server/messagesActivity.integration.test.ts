import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { activityLog, clients, financePayments, financeReceivables, products, quoteItems, quoteRooms, quotes, storeSettings } from "../drizzle/schema";
import { crc16 } from "../shared/pix";
import { getDb } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ADMIN_ID = 999_998_101;
const OPERATOR_ID = 999_998_102;
const created = { quotes: [] as number[], clients: [] as number[], products: [] as number[] };
let originalSettings: typeof storeSettings.$inferSelect | undefined;

function contextWith(user: Partial<NonNullable<TrpcContext["user"]>> & { id: number; role: "user" | "admin" }): TrpcContext {
  return {
    user: { username: `teste${user.id}`, name: `Pessoa ${user.id}`, isActive: true, ...user } as TrpcContext["user"],
    req: { protocol: "https", headers: {}, ip: "203.0.113.9" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
// Intl.NumberFormat usa espaço não separável entre "R$" e o valor.
const plain = (text: string) => text.replace(/\u00a0/g, " ");
const admin = () => appRouter.createCaller(contextWith({ id: ADMIN_ID, role: "admin", name: "Ana Admin" }));
const operator = () => appRouter.createCaller(contextWith({ id: OPERATOR_ID, role: "user", name: "Bruno Vendas" }));

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  if (created.quotes.length) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(inArray(financeReceivables.quoteId, created.quotes));
    if (receivables.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
    await db.delete(financeReceivables).where(inArray(financeReceivables.quoteId, created.quotes));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(inArray(quoteRooms.quoteId, created.quotes));
    if (rooms.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id)));
    await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, created.quotes));
    await db.delete(quotes).where(inArray(quotes.id, created.quotes));
  }
  if (created.clients.length) await db.delete(clients).where(inArray(clients.id, created.clients));
  if (created.products.length) await db.delete(products).where(inArray(products.id, created.products));
  await db.delete(activityLog).where(inArray(activityLog.userId, [ADMIN_ID, OPERATOR_ID]));
  if (originalSettings) await db.update(storeSettings).set({ pixKey: originalSettings.pixKey, pixRecipient: originalSettings.pixRecipient, pixCity: originalSettings.pixCity, tradingName: originalSettings.tradingName }).where(eq(storeSettings.id, 1));
  created.quotes = []; created.clients = []; created.products = []; originalSettings = undefined;
}

async function approvedQuoteFor(clientId: number, phone: string | null, firstDueDate: Date) {
  const caller = operator();
  const quote = (await caller.quote.create())!;
  created.quotes.push(quote.id);
  const saved = await caller.quote.save({
    id: quote.id, quoteNumber: quote.quoteNumber, clientId, clientName: "Marina Teste", professional: "Arq. Paulo", phone,
    status: "approved", issueDate: firstDueDate, validUntil: null, discountMode: "percentage", discountValue: 0, shipping: 0,
    pixDiscountMode: "percentage", pixDiscountValue: 0, installments: 2, notes: null,
    rooms: [{ name: "SALA", items: [{ code: "T1", shortDescription: "Pendente LED", unit: "UN", quantity: 1, unitPrice: 400 }] }],
  });
  return saved!;
}

describe("mensagens, PIX e registro de atividades", () => {
  afterEach(cleanup);

  it("monta a cobrança da parcela com PIX válido e registra as ações", async () => {
    const db = (await getDb())!;
    await admin().settings.get();
    originalSettings = (await db.select().from(storeSettings).where(eq(storeSettings.id, 1)))[0];
    await db.update(storeSettings).set({ pixKey: "loja@luminno.com.br", pixRecipient: "Luminno Teste", pixCity: "Campinas", tradingName: "Luminno" }).where(eq(storeSettings.id, 1));
    const clientId = await operator().customers.save({ name: `Marina ${Date.now()}`, professional: "Arq. Paulo", phone: "(19) 98888-7777", email: "marina@teste.com" });
    created.clients.push(clientId);

    // Primeira parcela vencida há 3 dias: deve aparecer como "Parcela vencida".
    const due = new Date(); due.setDate(due.getDate() - 3);
    const quote = await approvedQuoteFor(clientId, null, due);
    const [first] = await operator().finance.byQuote({ quoteId: quote.id });

    const message = await operator().finance.message({ receivableId: first!.id });
    expect(message.event).toBe("payment_overdue");
    expect(message.phone).toBe("5519988887777");
    expect(message.email).toBe("marina@teste.com");
    expect(message.body).toContain("parcela 1/2");
    expect(plain(message.body)).toContain("R$ 200,00");
    expect(message.pix).toContain("br.gov.bcb.pix");
    expect(message.pix).toContain("5406200.00");
    expect(message.pix).toContain("6008Campinas");
    expect(message.pix.slice(-4)).toBe(crc16(message.pix.slice(0, -4)));

    const pending = await operator().messages.pending();
    expect(pending.some((item) => item.receivableId === first!.id && item.event === "payment_overdue")).toBe(true);

    await operator().finance.recordPayment({ receivableId: first!.id, type: "receipt", amount: 50, paymentMethod: "pix", paidAt: new Date() });
    // Paga em parte, continua vencida: a cobrança deve seguir como atraso.
    expect((await operator().finance.message({ receivableId: first!.id })).event).toBe("payment_overdue");
    await operator().finance.recordPayment({ receivableId: first!.id, type: "reversal", amount: 50, paymentMethod: "pix", paidAt: new Date() });
    await operator().messages.logSent({ event: "payment_overdue", channel: "whatsapp", clientName: "Marina Teste", receivableId: first!.id, quoteId: quote.id });

    const log = await admin().activity.list({ userId: OPERATOR_ID });
    const summaries = log.entries.map((entry) => plain(entry.summary));
    expect(summaries).toContain(`Aprovou o orçamento #${quote.quoteNumber} (Marina Teste, R$ 400,00)`);
    expect(summaries).toContain(`Registrou recebimento de R$ 50,00 na parcela 1/2 de Marina Teste (orçamento #${quote.quoteNumber})`);
    expect(summaries).toContain(`Estornou de R$ 50,00 na parcela 1/2 de Marina Teste (orçamento #${quote.quoteNumber})`);
    expect(summaries).toContain('Enviou "Parcela vencida" para Marina Teste por WhatsApp');
    expect(log.entries[0]).toMatchObject({ userName: "Bruno Vendas", ip: "203.0.113.9" });

    const financeOnly = await admin().activity.list({ entityType: "finance", userId: OPERATOR_ID });
    expect(financeOnly.entries.every((entry) => entry.entityType === "finance")).toBe(true);
  });

  it("registra mudança de status do orçamento e de preço no catálogo", async () => {
    const caller = operator();
    const quote = (await caller.quote.create())!;
    created.quotes.push(quote.id);
    const base = { id: quote.id, quoteNumber: quote.quoteNumber, clientId: null, clientName: "Cliente Status", professional: "", issueDate: new Date(), validUntil: null, discountMode: "percentage" as const, discountValue: 0, shipping: 0, pixDiscountMode: "percentage" as const, pixDiscountValue: 0, installments: 1, notes: null, rooms: [{ name: "GERAL", items: [{ code: "X", shortDescription: "Item", unit: "UN", quantity: 1, unitPrice: 10 }] }] };
    await caller.quote.save({ ...base, status: "open" });
    await caller.quote.save({ ...base, status: "open", discountValue: 1 }); // edição comum: não registra
    await caller.quote.save({ ...base, status: "lost", lostReason: "price" });

    const productId = await caller.product.save({ shortDescription: "Spot teste atividade", unitPrice: 100, unit: "UN", reorderPoint: 0, active: true });
    created.products.push(productId);
    await caller.product.save({ id: productId, shortDescription: "Spot teste atividade", unitPrice: 129.9, unit: "UN", reorderPoint: 0, active: true });

    const log = await admin().activity.list({ userId: OPERATOR_ID });
    const summaries = log.entries.map((entry) => plain(entry.summary));
    expect(summaries.filter((text) => text.includes(`orçamento #${quote.quoteNumber}`))).toEqual([
      `Marcou como não aprovado o orçamento #${quote.quoteNumber} (Cliente Status, R$ 10,00) — motivo: preço`,
      `Mudou para em aberto o orçamento #${quote.quoteNumber} (Cliente Status, R$ 10,00)`,
      `Criou o orçamento #${quote.quoteNumber}`,
    ]);
    expect(summaries.some((text) => /Alterou o produto #\d+ Spot teste atividade: preço R\$ 100,00 → R\$ 129,90/.test(text))).toBe(true);
    const search = await admin().activity.list({ search: "Spot teste atividade" });
    expect(search.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("restringe o registro de atividades a administradores", async () => {
    await expect(operator().activity.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
