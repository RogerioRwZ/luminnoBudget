import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createECDH } from "node:crypto";
import { createLocalUser } from "./localUserDb";
import { users } from "../drizzle/schema";
import { financePayments, financeReceivables, products, pushSubscriptions, quoteItemReservations, quoteItems, quoteRooms, quotes, stockLoanItems, stockLoans, stockMovements } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { pushStatus, runDailyPush, savePushSubscription, sendPushToUser } from "./pushDb";
import { b64url } from "./webPushCrypto";

const caller = (role: "sales" | "stock" | "finance" | "user", id = 999_004) =>
  appRouter.createCaller({ user: { id, role, name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });

const created = { productIds: [] as number[], quoteId: 0, loanIds: [] as number[], userIds: [] as number[] };
afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (created.loanIds.length) {
    await db.delete(stockLoanItems).where(inArray(stockLoanItems.loanId, created.loanIds));
    await db.delete(stockLoans).where(inArray(stockLoans.id, created.loanIds));
  }
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
  if (created.productIds.length) {
    await db.delete(stockMovements).where(inArray(stockMovements.productId, created.productIds));
    await db.delete(products).where(inArray(products.id, created.productIds));
  }
  if (created.userIds.length) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, created.userIds));
    await db.delete(users).where(inArray(users.id, created.userIds));
  }
  Object.assign(created, { productIds: [], quoteId: 0, loanIds: [], userIds: [] });
});

const stockOf = async (productId: number) => {
  const db = (await getDb())!;
  return Number((await db.select({ stock: products.stockQuantity }).from(products).where(eq(products.id, productId)))[0]!.stock);
};

describe("mostruário e consignação", () => {
  it("empresta sem usar o reservado e acerta devolução, venda e perda", async () => {
    const stamp = Date.now();
    const admin = caller("user");
    const productId = await admin.product.save({ reference: `T-${Math.random().toString(36).slice(2, 10)}`, shortDescription: `Pendente mostruário ${stamp}`, unit: "UN", unitPrice: 200, costPrice: 80, reorderPoint: 0, active: true });
    created.productIds.push(productId);
    await admin.inventory.move({ productId, type: "entry", quantity: 5, occurredAt: new Date() });

    // 3 ficam reservadas para um pedido aprovado: só 2 podem sair emprestadas.
    const quote = (await admin.quote.create())!;
    created.quoteId = quote.id;
    await admin.quote.save({
      id: quote.id, clientName: "Pedido com reserva", status: "approved", issueDate: new Date(),
      discountMode: "percentage", discountValue: 0, shipping: 0, pixDiscountMode: "percentage", pixDiscountValue: 0, installments: 1,
      rooms: [{ name: "Sala", items: [{ productId, code: "M", shortDescription: "Pendente", unit: "UN", quantity: 3, unitPrice: 200 }] }],
    });
    const sales = caller("sales");
    const due = new Date();
    await expect(sales.loans.create({ borrowerName: "Arq. Ana", borrowerKind: "professional", dueDate: due, items: [{ productId, quantity: 3 }] })).rejects.toThrow(/reservada/);

    const loan = await sales.loans.create({ borrowerName: "Arq. Ana", borrowerKind: "professional", phone: "11999990000", dueDate: due, items: [{ productId, quantity: 2 }] });
    created.loanIds.push(loan.id);
    expect(loan).toMatchObject({ open: true, pending: 2, overdue: false });
    expect(await stockOf(productId)).toBe(3);
    const overview = await caller("stock").inventory.overview();
    expect(overview.products.find((row) => row.id === productId)).toMatchObject({ stockQuantity: 3, reservedQuantity: 3, availableQuantity: 0, loanedQuantity: 2 });

    // Devolução hoje: aparece no Resumo do dia de Vendas e Estoque, não no do Financeiro.
    expect((await sales.summary.today()).loans?.items.some((row) => row.id === loan.id)).toBe(true);
    expect((await caller("finance").summary.today()).loans).toBeNull();

    const item = loan.items[0]!;
    await expect(sales.loans.settle({ loanId: loan.id, lines: [{ itemId: item.id, returned: 2, sold: 1, lost: 0 }] })).rejects.toThrow(/Só 2/);
    const partial = await sales.loans.settle({ loanId: loan.id, lines: [{ itemId: item.id, returned: 1, sold: 0, lost: 0 }] });
    expect(partial).toMatchObject({ open: true, pending: 1 });
    expect(await stockOf(productId)).toBe(4);

    const closed = await caller("stock").loans.settle({ loanId: loan.id, quoteNumber: quote.quoteNumber, lines: [{ itemId: item.id, returned: 0, sold: 1, lost: 0 }], notes: "Ficou com a peça" });
    expect(closed).toMatchObject({ open: false, pending: 0, quoteNumber: quote.quoteNumber });
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(await stockOf(productId)).toBe(5);

    const db = (await getDb())!;
    const kinds = (await db.select({ type: stockMovements.type, quantity: stockMovements.quantity }).from(stockMovements).where(eq(stockMovements.productId, productId))).map((row) => `${row.type}:${Number(row.quantity)}`);
    expect(kinds).toEqual(["entry:5", "loan_out:-2", "loan_return:1", "loan_return:1"]);

    // Perda: não volta ao estoque.
    const lostLoan = await sales.loans.create({ borrowerName: "Cliente Bia", borrowerKind: "client", dueDate: due, items: [{ productId, quantity: 1 }] });
    created.loanIds.push(lostLoan.id);
    await expect(caller("finance").loans.list()).rejects.toThrow();
    const lost = await sales.loans.settle({ loanId: lostLoan.id, lines: [{ itemId: lostLoan.items[0]!.id, returned: 0, sold: 0, lost: 1 }] });
    expect(lost.open).toBe(false);
    expect(await stockOf(productId)).toBe(4);
  });
});

describe("giro de estoque", () => {
  it("aponta parados pelo tempo sem venda e monta a curva ABC", async () => {
    const stamp = Date.now();
    const admin = caller("user");
    const idle = await admin.product.save({ reference: `T-${Math.random().toString(36).slice(2, 10)}`, shortDescription: `Parado giro ${stamp}`, unit: "UN", unitPrice: 50, costPrice: 20, reorderPoint: 0, active: true });
    const seller = await admin.product.save({ reference: `T-${Math.random().toString(36).slice(2, 10)}`, shortDescription: `Vendido giro ${stamp}`, unit: "UN", unitPrice: 100, costPrice: 40, reorderPoint: 0, active: true });
    created.productIds.push(idle, seller);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60_000);
    await admin.inventory.move({ productId: idle, type: "entry", quantity: 4, occurredAt: old });
    await admin.inventory.move({ productId: seller, type: "entry", quantity: 10, occurredAt: old });
    const quote = (await admin.quote.create())!;
    created.quoteId = quote.id;
    await admin.quote.save({
      id: quote.id, clientName: "Cliente giro", status: "approved", issueDate: new Date(),
      discountMode: "percentage", discountValue: 0, shipping: 0, pixDiscountMode: "percentage", pixDiscountValue: 0, installments: 1,
      rooms: [{ name: "Sala", items: [{ productId: seller, code: "V", shortDescription: "Vendido", unit: "UN", quantity: 2, unitPrice: 100 }] }],
    });

    const stale = await caller("stock").inventory.stale({ days: 180 });
    expect(stale.rows.find((row) => row.productId === idle)).toMatchObject({ stock: 4, value: 80, lastSaleAt: null });
    expect(stale.rows.find((row) => row.productId === idle)!.idleDays).toBeGreaterThanOrEqual(199);
    expect(stale.rows.some((row) => row.productId === seller)).toBe(false);

    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const abc = await admin.inventory.abc({ from, to: new Date(from.getTime() + 24 * 60 * 60_000) });
    const row = abc.rows.find((entry) => entry.productId === seller)!;
    expect(row).toMatchObject({ revenue: 200, quantity: 2, stock: 10 });
    expect(["A", "B", "C"]).toContain(row.abc);
    await expect(caller("sales").inventory.stale({ days: 90 })).rejects.toThrow();
  });
});

describe("avisos no celular", () => {
  it("cifra, assina e entrega; remove a inscrição que o serviço recusa", async () => {
    const received: Array<{ path: string; headers: IncomingHttpHeaders; size: number }> = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        received.push({ path: req.url ?? "", headers: req.headers, size: Buffer.concat(chunks).length });
        res.statusCode = req.url?.includes("gone") ? 410 : 201;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const user = await createLocalUser({ username: `aviso.${Date.now()}`, name: "Teste avisos", password: "senha-de-teste-longa-123", role: "sales" });
      const userId = user.id;
      created.userIds.push(userId);
      const keys = (path: string) => {
        const ua = createECDH("prime256v1");
        ua.generateKeys();
        return { endpoint: `${base}/${path}`, p256dh: b64url(ua.getPublicKey()), auth: b64url(Buffer.alloc(16, 3)) };
      };
      await savePushSubscription(userId, keys("ok"));
      await savePushSubscription(userId, keys("gone"));

      const result = await sendPushToUser(userId, { title: "Teste", body: "Olá" });
      expect(result).toEqual({ sent: 1, removed: 1, failed: 0 });
      const ok = received.find((entry) => entry.path === "/ok")!;
      expect(ok.headers["content-encoding"]).toBe("aes128gcm");
      expect(ok.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
      expect(ok.size).toBeGreaterThan(86);
      const db = (await getDb())!;
      expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).toHaveLength(1);

      // Pelo tRPC: estado do aparelho e desativação.
      const me = caller("sales", userId);
      expect(await pushStatus(userId, `${base}/ok`)).toEqual({ devices: 1, thisDevice: true });
      // A rota só aceita endereços HTTPS, como os dos serviços de push reais.
      await expect(me.push.status({ endpoint: `${base}/ok` })).rejects.toThrow(/inválido/);
      expect((await me.push.publicKey()).length).toBe(87);
      await savePushSubscription(userId, keys("depois"));
      await me.push.unsubscribe({ endpoint: `https://example.com/nao-existe` }).catch(() => undefined);
      expect((await me.push.status({})).devices).toBe(2);

      // Resumo diário: só uma vez por dia por aparelho.
      received.length = 0;
      const morning = new Date();
      morning.setHours(9, 0, 0, 0);
      await runDailyPush(morning);
      const firstRound = received.length;
      await runDailyPush(new Date(morning.getTime() + 60 * 60_000));
      expect(received.length).toBe(firstRound);
      const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      expect(rows.length).toBe(2);
      expect(rows.every((row) => row.lastDailyAt)).toBe(true);

      // Inscrição de usuário que não existe mais é apagada.
      await savePushSubscription(999_999_001, keys("orfa"));
      await runDailyPush(new Date(morning.getTime() + 2 * 60 * 60_000));
      expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, 999_999_001))).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});
