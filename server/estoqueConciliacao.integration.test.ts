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
  const id = await admin.product.save({ reference: `REC-${Math.random().toString(36).slice(2, 10)}`, shortDescription: "Produto correções", unit: "UN", unitPrice: 10, reorderPoint: 0, warrantyMonths, active: true });
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


// Confere, em qualquer momento, se todos os números do estoque batem entre si.
async function expectConsistent(ids: number[]) {
  const db = (await getDb())!;
  const overview = await admin.inventory.overview();
  const movements = await db.select().from(stockMovements).where(inArray(stockMovements.productId, ids));
  const reservations = await db.select().from(quoteItemReservations).where(inArray(quoteItemReservations.productId, ids));
  const cents = (value: number) => Math.round(value * 100);
  for (const id of ids) {
    const row = overview.products.find((item) => item.id === id)!;
    const own = movements.filter((movement) => movement.productId === id).sort((first, second) => first.id - second.id);
    // O saldo é a soma das movimentações e o "depois" da última.
    expect(cents(own.reduce((sum, movement) => sum + Number(movement.quantity), 0))).toBe(cents(row.stockQuantity));
    if (own.length) expect(cents(Number(own[own.length - 1]!.afterQuantity))).toBe(cents(row.stockQuantity));
    // Cada movimentação parte de onde a anterior parou.
    own.forEach((movement, index) => {
      expect(cents(Number(movement.beforeQuantity) + Number(movement.quantity))).toBe(cents(Number(movement.afterQuantity)));
      if (index) expect(cents(Number(movement.beforeQuantity))).toBe(cents(Number(own[index - 1]!.afterQuantity)));
    });
    const reserved = reservations.filter((reservation) => reservation.productId === id).reduce((sum, reservation) => sum + Number(reservation.reservedQuantity), 0);
    expect(cents(row.reservedQuantity)).toBe(cents(reserved));
    expect(cents(row.availableQuantity)).toBe(cents(row.stockQuantity - reserved));
    expect(row.availableQuantity).toBeGreaterThanOrEqual(0);
  }
  // O total é a soma de saldo vezes preço de todas as linhas mostradas.
  const expected = overview.products.reduce((sum, row) => sum + row.stockQuantity * row.unitPrice, 0);
  expect(overview.stockValue).toBeCloseTo(expected, 2);
  return overview;
}

describe("conciliação do estoque", () => {
  it("saldo, reservas, disponível e valor batem em toda a vida de um produto", async () => {
    const a = await product(0);
    const b = await product(0);
    const ids = [a, b];
    await admin.inventory.move({ productId: a, type: "entry", quantity: 10.5, occurredAt: new Date() });
    await admin.inventory.move({ productId: b, type: "entry", quantity: 4, occurredAt: new Date() });
    let view = await expectConsistent(ids);
    expect(ids.reduce((sum, id) => { const row = view.products.find((item) => item.id === id)!; return sum + row.stockQuantity * row.unitPrice; }, 0)).toBeCloseTo(145, 2);

    // Ajuste, para cima e para baixo; o saldo não fica abaixo de zero.
    await admin.inventory.move({ productId: a, type: "adjustment", quantity: -0.5, occurredAt: new Date() });
    await admin.inventory.move({ productId: a, type: "adjustment", quantity: 2, occurredAt: new Date() });
    await expect(admin.inventory.move({ productId: b, type: "adjustment", quantity: -5, occurredAt: new Date() })).rejects.toThrow(/insuficiente/);
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === a)!.stockQuantity).toBe(12);

    // Aprovar reserva, sem mudar o físico; o que faltar fica aguardando compra.
    const sale = await quote([{ productId: a, quantity: 5 }, { productId: b, quantity: 6 }]);
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === a)).toMatchObject({ stockQuantity: 12, reservedQuantity: 5, availableQuantity: 7 });
    expect(view.products.find((row) => row.id === b)).toMatchObject({ stockQuantity: 4, reservedQuantity: 4, availableQuantity: 0 });
    await expect(admin.inventory.move({ productId: b, type: "adjustment", quantity: -1, occurredAt: new Date() })).rejects.toThrow(/reservada/);

    // Retirada parcial baixa físico e reserva juntos.
    const [itemA, itemB] = sale.items as [{ id: number }, { id: number }];
    const delivery = await deliver(sale.id, itemA.id, 2);
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === a)).toMatchObject({ stockQuantity: 10, reservedQuantity: 3, availableQuantity: 7 });

    // A entrada vai primeiro para quem esperava.
    await admin.inventory.move({ productId: b, type: "entry", quantity: 5, occurredAt: new Date() });
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === b)).toMatchObject({ stockQuantity: 9, reservedQuantity: 6, availableQuantity: 3 });

    // Estorno devolve ao físico e o item volta a reservar.
    await admin.inventory.reverseDelivery({ deliveryId: delivery.deliveryId, reason: "Lançada por engano" });
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === a)).toMatchObject({ stockQuantity: 12, reservedQuantity: 5, availableQuantity: 7 });

    // Cancelar saldo libera a reserva e não mexe no físico; desfazer volta.
    const cancelled = await admin.inventory.cancelRemainder({ quoteId: sale.id, lines: [{ quoteItemId: itemB.id, quantity: 2 }], reason: "Desistiu" });
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === b)).toMatchObject({ stockQuantity: 9, reservedQuantity: 4, availableQuantity: 5 });
    expect(cancelled).toBeTruthy();

    // Empréstimo tira do físico e volta no acerto.
    const loan = await admin.loans.create({ borrowerName: "Mostruário", borrowerKind: "client", dueDate: new Date(), items: [{ productId: a, quantity: 3 }] });
    loanIds.push(loan.id);
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === a)).toMatchObject({ stockQuantity: 9, loanedQuantity: 3, availableQuantity: 4 });
    await admin.loans.settle({ loanId: loan.id, lines: [{ itemId: loan.items[0]!.id, returned: 2, sold: 0, lost: 1 }] });
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === a)).toMatchObject({ stockQuantity: 11, loanedQuantity: 0 });

    // Reabrir o orçamento libera as reservas.
    await admin.quote.save({ ...sale.input, status: "open" });
    view = await expectConsistent(ids);
    expect(view.products.find((row) => row.id === a)!.reservedQuantity).toBe(0);
  }, 60_000);

  it("produto arquivado com saldo continua no valor; sem saldo, sai", async () => {
    const id = await product(2);
    await admin.product.archive({ id });
    const archived = await expectConsistent([id]);
    expect(archived.products.find((row) => row.id === id)).toMatchObject({ active: false, stockQuantity: 2, unitPrice: 10 });
    await admin.inventory.move({ productId: id, type: "adjustment", quantity: -2, occurredAt: new Date() });
    expect((await admin.inventory.overview()).products.some((row) => row.id === id)).toBe(false);
  }, 30_000);

  it("arquivado com saldo não acusa reposição em nenhum lugar", async () => {
    const id = await admin.product.save({ reference: `REC-${Math.random().toString(36).slice(2, 10)}`, shortDescription: "Arquivado", unit: "UN", unitPrice: 10, reorderPoint: 5, active: true });
    productIds.push(id);
    await admin.inventory.move({ productId: id, type: "entry", quantity: 1, occurredAt: new Date() });
    await admin.product.archive({ id });
    const view = await admin.inventory.overview();
    expect(view.lowStock.some((row) => row.id === id)).toBe(false);
    expect(view.products.find((row) => row.id === id)!.lowStock).toBe(false);
  }, 30_000);
});

describe("busca no histórico", () => {
  it("acha por produto, sem acento, orçamento, responsável e observação, e filtra por tipo", async () => {
    const tag = Math.random().toString(36).slice(2, 10);
    const id = await admin.product.save({ reference: `HIS-${tag}`, shortDescription: `Lâmpada ${tag}`, fullDescription: `Filamento ${tag}`, barcode: `9${Date.now()}`, supplierName: `Forn ${tag}`, unit: "UN", unitPrice: 10, reorderPoint: 0, active: true });
    productIds.push(id);
    await admin.inventory.move({ productId: id, type: "entry", quantity: 5, notes: `Nota fiscal ${tag}`, occurredAt: new Date() });
    await admin.inventory.move({ productId: id, type: "adjustment", quantity: -1, notes: "Quebra", occurredAt: new Date() });
    const sale = await quote([{ productId: id, quantity: 2 }]);
    await deliver(sale.id, sale.items[0]!.id, 2);
    const search = async (text: string, type?: "entry" | "delivery") => (await admin.inventory.movements({ search: text, type })).rows;

    expect(await search(`HIS-${tag}`)).toHaveLength(3);
    expect(await search(`lampada ${tag}`)).toHaveLength(3);
    expect(await search(`${tag} filamento`)).toHaveLength(3);
    expect(await search(`Forn ${tag}`)).toHaveLength(3);
    expect(await search(`HIS-${tag}`, "entry")).toHaveLength(1);
    expect((await search(`Nota fiscal ${tag}`))[0]).toMatchObject({ type: "entry", quantity: 5, beforeQuantity: 0, afterQuantity: 5 });
    const delivered = await search(`HIS-${tag}`, "delivery");
    expect(delivered[0]!.quantity).toBe(-2);
    expect(delivered[0]!.product).toMatchObject({ reference: `HIS-${tag}` });
    expect(await search(`#${delivered[0]!.quoteNumber} ${tag}`)).toHaveLength(1);
    expect(await search(`${tag} naoexiste`)).toHaveLength(0);
    // Curinga digitado é texto comum.
    expect(await search(`${tag}%`)).toHaveLength(0);
    expect(await search(`${tag}_`)).toHaveLength(0);
  }, 30_000);

  it("não deixa quem não tem estoque consultar", async () => {
    const sales = appRouter.createCaller({ user: { id: 999_010, role: "sales", name: "V", username: "v" } as any, req: { headers: {}, ip: "127.0.0.1", socket: {} } as any, res: { clearCookie() {}, cookie() {} } as any });
    await expect(sales.inventory.movements({})).rejects.toThrow();
  });
});

describe("responsável pela retirada", () => {
  it("é sempre o usuário logado, em todas as formas de retirar e no estorno", async () => {
    const db = (await getDb())!;
    const id = await product(10);
    const sale = await quote([{ productId: id, quantity: 6 }]);
    const itemId = sale.items[0]!.id;
    const forged = { responsible: "Outra pessoa" } as object;
    const one = await admin.inventory.deliver({ quoteId: sale.id, quoteItemId: itemId, quantity: 1, deliveredAt: new Date(), ...forged });
    await admin.inventory.deliverMany({ quoteId: sale.id, lines: [{ quoteItemId: itemId, quantity: 1 }], deliveredAt: new Date(), ...forged });
    await admin.inventory.deliverAll({ quoteId: sale.id, deliveredAt: new Date(), notes: "Retirado pelo motorista" });
    await admin.inventory.reverseDelivery({ deliveryId: one.deliveryId, reason: "Lançada por engano", ...forged });
    const deliveries = await db.select().from(quoteItemDeliveries).where(eq(quoteItemDeliveries.quoteId, sale.id));
    expect(deliveries).toHaveLength(3);
    expect(deliveries.every((row) => row.responsible === "Teste")).toBe(true);
    expect(deliveries.some((row) => row.notes === "Retirado pelo motorista")).toBe(true);
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.productId, id));
    expect(moves.filter((row) => row.type !== "entry")).toHaveLength(4);
    expect(moves.filter((row) => row.type !== "entry").every((row) => row.responsible === "Teste")).toBe(true);
    const logged = await admin.inventory.movements({ search: "Outra pessoa" });
    expect(logged.rows.filter((row) => row.productId === id)).toHaveLength(0);
  }, 30_000);
});

describe("ajuste pela quantidade real", () => {
  const stockNow = async (id: number) => (await admin.inventory.overview()).products.find((row) => row.id === id)!;

  it("lança a diferença, para mais, para menos e até zero", async () => {
    const id = await product(5);
    const up = await admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 8.5, occurredAt: new Date() });
    expect(up).toMatchObject({ beforeQuantity: 5, afterQuantity: 8.5 });
    await admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 3, occurredAt: new Date() });
    expect((await stockNow(id)).stockQuantity).toBe(3);
    await admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 0, occurredAt: new Date() });
    expect((await stockNow(id)).stockQuantity).toBe(0);
    const db = (await getDb())!;
    const moves = (await db.select().from(stockMovements).where(eq(stockMovements.productId, id))).filter((row) => row.type === "adjustment").sort((first, second) => first.id - second.id);
    expect(moves.map((row) => row.quantity)).toEqual(["3.50", "-5.50", "-3.00"]);
    await expectConsistent([id]);
  }, 30_000);

  it("vale sobre o saldo do momento, mesmo depois de outra movimentação", async () => {
    const id = await product(5);
    await admin.inventory.move({ productId: id, type: "entry", quantity: 10, occurredAt: new Date() });
    const result = await admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 12, occurredAt: new Date() });
    expect(result).toMatchObject({ beforeQuantity: 15, afterQuantity: 12 });
    await expectConsistent([id]);
  }, 30_000);

  it("recusa saldo igual, negativo, abaixo do reservado e fora do ajuste", async () => {
    const id = await product(5);
    await expect(admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 5, occurredAt: new Date() })).rejects.toThrow(/Não há o que ajustar/);
    await expect(admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: -1, occurredAt: new Date() })).rejects.toThrow(/negativa/);
    await expect(admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 1.005, occurredAt: new Date() })).rejects.toThrow(/2 casas/);
    await expect(admin.inventory.move({ productId: id, type: "entry", countedQuantity: 9, occurredAt: new Date() })).rejects.toThrow(/só vale para o ajuste/);
    await expect(admin.inventory.move({ productId: id, type: "adjustment", occurredAt: new Date() })).rejects.toThrow(/Informe a quantidade/);
    await quote([{ productId: id, quantity: 3 }]);
    await expect(admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 2, occurredAt: new Date() })).rejects.toThrow(/reservada/);
    await admin.inventory.move({ productId: id, type: "adjustment", countedQuantity: 3, occurredAt: new Date() });
    expect(await stockNow(id)).toMatchObject({ stockQuantity: 3, reservedQuantity: 3, availableQuantity: 0 });
  }, 30_000);
});
