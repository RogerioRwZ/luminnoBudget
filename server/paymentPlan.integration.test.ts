import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { financePayments, financeReceivables, quoteItemReservations, quoteItems, quoteRooms, quotes, storeSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { getSettings } from "./quoteDb";
import { addDaysInput } from "../shared/paymentPlan";

const caller = () => appRouter.createCaller({ user: { id: 999_006, role: "user", name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });

const created = { quoteIds: [] as number[], cardFees: undefined as string | null | undefined };
afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (created.quoteIds.length) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(inArray(financeReceivables.quoteId, created.quoteIds));
    if (receivables.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivables.map((row) => row.id)));
    await db.delete(financeReceivables).where(inArray(financeReceivables.quoteId, created.quoteIds));
    await db.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteId, created.quoteIds));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(inArray(quoteRooms.quoteId, created.quoteIds));
    if (rooms.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id)));
    await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, created.quoteIds));
    await db.delete(quotes).where(inArray(quotes.id, created.quoteIds));
  }
  if (created.cardFees !== undefined) await db.update(storeSettings).set({ cardFees: created.cardFees }).where(eq(storeSettings.id, 1));
  Object.assign(created, { quoteIds: [], cardFees: undefined });
});

// Orçamento de R$ 1.000,00 (sem frete), PIX com 10% de desconto: R$ 900,00 à vista.
async function newQuote(clientName: string) {
  const admin = caller();
  const quote = (await admin.quote.create())!;
  created.quoteIds.push(quote.id);
  const draft = {
    id: quote.id, clientName, professional: "", status: "open" as const, issueDate: new Date(),
    discountMode: "percentage" as const, discountValue: 0, shipping: 0, pixDiscountMode: "percentage" as const, pixDiscountValue: 10, installments: 3,
    rooms: [{ name: "Sala", items: [{ productId: null, code: "S", shortDescription: "Projeto", unit: "SV", quantity: 1, unitPrice: 1000 }] }],
  };
  await admin.quote.save(draft);
  return { admin, draft, quote };
}

const receivablesOf = async (quoteId: number) => {
  const db = (await getDb())!;
  return db.select().from(financeReceivables).where(eq(financeReceivables.quoteId, quoteId));
};

describe("forma de pagamento na aprovação", () => {
  it("cartão de crédito: um recebimento na hora, com a taxa da maquininha, sem parcelas mensais", async () => {
    const db = (await getDb())!;
    // Num banco novo (como o do CI) a linha das Configurações só nasce na
    // primeira leitura; sem ela, o UPDATE abaixo não grava as taxas.
    await getSettings();
    created.cardFees = (await db.select({ cardFees: storeSettings.cardFees }).from(storeSettings).where(eq(storeSettings.id, 1)))[0]?.cardFees ?? null;
    await db.update(storeSettings).set({ cardFees: JSON.stringify({ debit: 1, credit: [3, 4, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8] }) }).where(eq(storeSettings.id, 1));

    const { admin, draft, quote } = await newQuote("Cliente cartão");
    const saved = await admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "credit_card", amount: 1000, installments: 3 }] } });
    expect(JSON.parse(saved!.paymentPlan!)).toEqual({ parts: [{ method: "credit_card", amount: 1000, installments: 3 }] });
    const rows = await receivablesOf(quote.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "paid", paymentMethod: "credit_card", installmentCount: 1, originalAmount: "1000.00" });
    const payment = (await db.select().from(financePayments).where(eq(financePayments.receivableId, rows[0]!.id)))[0]!;
    expect(payment).toMatchObject({ type: "receipt", amount: "1000.00", paymentMethod: "credit_card", feeAmount: "50.00", notes: "3x na maquininha" });
    const overview = await admin.finance.overview();
    expect(overview.totals.cardFeesThisMonth).toBeGreaterThanOrEqual(50);

    // Depois de aprovado, a forma de pagamento fica travada como os valores.
    await expect(admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "pix", amount: 900, installments: 1 }] } })).rejects.toThrow(/Em aberto/);
    // Com dinheiro recebido, não volta para Em aberto.
    await expect(admin.quote.save({ ...draft, status: "open" })).rejects.toThrow(/recebimentos/);
  });

  it("entrada no PIX + crediário: entrada recebida e parcelas mensais marcadas como crediário", async () => {
    const { admin, draft, quote } = await newQuote("Cliente crediário");
    const first = addDaysInput(30);
    await admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "pix", amount: 300, installments: 1 }, { method: "store_credit", amount: 700, installments: 3, firstDueDate: first }] } });
    const rows = (await receivablesOf(quote.id)).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id - b.id);
    expect(rows.map((row) => `${row.paymentMethod}:${row.originalAmount}:${row.status}`)).toEqual(["pix:300.00:paid", "store_credit:233.34:open", "store_credit:233.33:open", "store_credit:233.33:open"]);
    const firstDue = rows[1]!.dueDate;
    expect(`${firstDue.getFullYear()}-${String(firstDue.getMonth() + 1).padStart(2, "0")}-${String(firstDue.getDate()).padStart(2, "0")}`).toBe(first);
    expect(rows[2]!.dueDate.getMonth()).toBe((firstDue.getMonth() + 1) % 12);
  });

  it("valida o total: PIX à vista vale o preço com desconto; outras formas, o total", async () => {
    const { admin, draft } = await newQuote("Cliente validação");
    await expect(admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "pix", amount: 1000, installments: 1 }] } })).rejects.toThrow(/somam R\$\s?1\.000,00, mas a venda é de R\$\s?900,00/);
    await expect(admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "boleto", amount: 1000, installments: 2 }] } })).rejects.toThrow(/vencimento da primeira parcela/);
    await expect(admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "credit_card", amount: 500, installments: 2 }, { method: "pix", amount: 400, installments: 1 }] } })).rejects.toThrow(/mas a venda é de/);
    const saved = await admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "pix", amount: 900, installments: 1 }] } });
    expect(saved?.status).toBe("approved");
  });

  it("sair de Aprovado cancela as parcelas sem recebimento e reaprovar gera as da nova forma", async () => {
    const { admin, draft, quote } = await newQuote("Cliente reaprovação");
    await admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "boleto", amount: 1000, installments: 4, firstDueDate: addDaysInput(10) }] } });
    expect((await receivablesOf(quote.id)).filter((row) => row.status !== "cancelled")).toHaveLength(4);
    const reopened = await admin.quote.save({ ...draft, status: "open" });
    expect(reopened?.paymentPlan).toBeNull();
    expect((await receivablesOf(quote.id)).every((row) => row.status === "cancelled")).toBe(true);
    await admin.quote.save({ ...draft, status: "approved", paymentPlan: { parts: [{ method: "debit_card", amount: 1000, installments: 1 }] } });
    const active = (await receivablesOf(quote.id)).filter((row) => row.status !== "cancelled");
    expect(active.map((row) => `${row.paymentMethod}:${row.status}`)).toEqual(["debit_card:paid"]);
  });

  it("vendas antigas: lista para revisão e converte as que foram no cartão", async () => {
    const { admin, draft, quote } = await newQuote("Cliente antigo");
    // Sem forma de pagamento (como antes desta versão): 3 parcelas mensais.
    await admin.quote.save({ ...draft, status: "approved" });
    const legacy = (await admin.finance.legacy()).find((row) => row.id === quote.id)!;
    expect(legacy).toMatchObject({ installments: 3, amount: 1000 });

    const paidAt = new Date(2026, 9, 15, 12);
    await admin.finance.settleLegacy({ quoteId: quote.id, method: "credit_card", installments: 3, paidAt });
    const rows = await receivablesOf(quote.id);
    expect(rows.filter((row) => row.status === "cancelled")).toHaveLength(3);
    const paid = rows.find((row) => row.status === "paid")!;
    expect(paid).toMatchObject({ paymentMethod: "credit_card", originalAmount: "1000.00" });
    const db = (await getDb())!;
    expect((await db.select().from(financePayments).where(eq(financePayments.receivableId, paid.id)))[0]!.paidAt.getTime()).toBe(paidAt.getTime());
    expect((await admin.finance.legacy()).some((row) => row.id === quote.id)).toBe(false);
    expect(JSON.parse((await admin.quote.get({ id: quote.id }))!.paymentPlan!).parts[0]).toMatchObject({ method: "credit_card", installments: 3 });
  });

  it("grava a entrada + crediário oferecida, copia ao duplicar e trava após aprovar", async () => {
    const { admin, draft, quote } = await newQuote("Cliente entrada");
    const offered = await admin.quote.save({ ...draft, entryOffer: { entryPercent: 40, installments: 5 } });
    expect(JSON.parse(offered!.entryOffer!)).toEqual({ entryPercent: 40, installments: 5 });
    // Sem enviar o campo, a condição gravada é mantida.
    expect(JSON.parse((await admin.quote.save(draft))!.entryOffer!)).toEqual({ entryPercent: 40, installments: 5 });

    const copy = (await admin.quote.duplicate({ id: quote.id }))!;
    created.quoteIds.push(copy.id);
    expect(JSON.parse(copy.entryOffer!)).toEqual({ entryPercent: 40, installments: 5 });

    const plan = { parts: [{ method: "pix" as const, amount: 400, installments: 1 }, { method: "store_credit" as const, amount: 600, installments: 5, firstDueDate: addDaysInput(30) }] };
    await admin.quote.save({ ...draft, status: "approved", entryOffer: { entryPercent: 40, installments: 5 }, paymentPlan: plan });
    await expect(admin.quote.save({ ...draft, status: "approved", entryOffer: { entryPercent: 50, installments: 5 }, paymentPlan: plan })).rejects.toThrow(/Em aberto/);
  });
});
