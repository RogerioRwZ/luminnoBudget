import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { clients, financePayments, financeReceivables, quoteItems, quoteRooms, quotes } from "../drizzle/schema";
import { getDb } from "./db";
import { financeByQuote, recordFinancePayment } from "./financeDb";
import { createQuote, customerStatement, saveClient, saveQuote } from "./quoteDb";

let clientId: number | null = null;
let quoteIds: number[] = [];

async function removeStatementData() {
  const db = await getDb();
  if (!db) return;
  if (quoteIds.length) {
    const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    const receivableIds = receivables.map((row) => row.id);
    if (receivableIds.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivableIds));
    await db.delete(financeReceivables).where(inArray(financeReceivables.quoteId, quoteIds));
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds));
    const roomIds = rooms.map((room) => room.id);
    if (roomIds.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds));
    await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, quoteIds));
    await db.delete(quotes).where(inArray(quotes.id, quoteIds));
  }
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  clientId = null;
  quoteIds = [];
}

async function quoteFor(status: "approved" | "lost" | "open", unitPrice: number) {
  const created = (await createQuote())!;
  quoteIds.push(created.id);
  return (await saveQuote({
    ...created,
    clientId,
    clientName: "Cliente da ficha",
    status,
    discountValue: 0,
    shipping: 0,
    pixDiscountValue: 0,
    installments: 2,
    rooms: [{ name: "SALA", items: [{ code: "FICHA", shortDescription: "Item da ficha", unit: "UN", quantity: 1, unitPrice }] }],
  }, 1))!;
}

describe("ficha do cliente", () => {
  afterEach(removeStatementData);

  it("consolida orçamentos, conversão e saldo financeiro do cliente", async () => {
    clientId = await saveClient({ name: `Cliente ficha ${Date.now()}`, professional: "Arquiteta" });
    const approved = await quoteFor("approved", 1000);
    await quoteFor("lost", 400);
    await quoteFor("open", 250);
    const [firstInstallment] = await financeByQuote(approved.id);
    await recordFinancePayment({ receivableId: firstInstallment!.id, type: "receipt", amount: 300, paymentMethod: "pix", paidAt: new Date() }, 1);

    const statement = await customerStatement(clientId);
    expect(statement?.quotes).toHaveLength(3);
    expect(statement?.totals).toMatchObject({ quoted: 1250, approved: 1000, received: 300, outstanding: 700, conversionRate: 0.5 });
    await expect(customerStatement(999_999_999)).resolves.toBeNull();
  });

  it("recusa salvar sobre um orçamento inexistente em vez de criar ambientes órfãos", async () => {
    await expect(saveQuote({
      id: 999_999_999,
      clientName: "",
      professional: "",
      status: "draft",
      issueDate: new Date(),
      discountMode: "percentage",
      discountValue: 0,
      shipping: 0,
      pixDiscountMode: "percentage",
      pixDiscountValue: 0,
      installments: 1,
      rooms: [{ name: "GERAL", items: [] }],
    })).rejects.toThrow("Orçamento não encontrado");
  });
});
