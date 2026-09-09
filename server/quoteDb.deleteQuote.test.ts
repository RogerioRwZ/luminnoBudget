import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { financeReceivables, quotes } from "../drizzle/schema";
import { createReceivablesFromQuote } from "./financeDb";
import { getDb } from "./db";
import { createQuote, deleteQuote, saveQuote } from "./quoteDb";

let createdQuoteId: number | null = null;

afterEach(async () => {
  if (!createdQuoteId) return;
  const db = await getDb();
  await db?.delete(financeReceivables).where(eq(financeReceivables.quoteId, createdQuoteId));
  await deleteQuote(createdQuoteId).catch(() => undefined);
  createdQuoteId = null;
});

describe("deleteQuote (proteção contra órfãos financeiros)", () => {
  it("recusa excluir um orçamento que já tem cobranças financeiras geradas, em vez de deixá-las órfãs silenciosamente", async () => {
    const created = await createQuote();
    createdQuoteId = created.id!;
    const saved = await saveQuote({
      ...created,
      status: "approved",
      clientName: "Cliente com cobrança",
      discountValue: Number(created.discountValue),
      shipping: Number(created.shipping),
      pixDiscountValue: Number(created.pixDiscountValue),
      rooms: [{ name: "GERAL", items: [{ code: "1", shortDescription: "Item cobrado", unit: "UN", quantity: 1, unitPrice: 100 }] }],
    });

    await createReceivablesFromQuote(
      { id: saved.id, quoteNumber: saved.quoteNumber, clientId: null, clientName: saved.clientName, installments: 1, issueDate: new Date(), summary: saved.summary },
      1
    );

    await expect(deleteQuote(saved.id)).rejects.toThrow("cobranças financeiras");

    // O orçamento e a cobrança devem continuar existindo — nada foi apagado.
    const stillThere = await (await getDb())!.select().from(quotes).where(eq(quotes.id, saved.id));
    expect(stillThere).toHaveLength(1);
    const receivable = await (await getDb())!.select().from(financeReceivables).where(eq(financeReceivables.quoteId, saved.id));
    expect(receivable.length).toBeGreaterThan(0);
  });

  it("continua permitindo excluir um orçamento sem cobranças ou entregas", async () => {
    const created = await createQuote();
    createdQuoteId = created.id!;
    await expect(deleteQuote(created.id!)).resolves.toBeUndefined();
    createdQuoteId = null; // já foi excluído com sucesso, não precisa limpar de novo
  });
});
