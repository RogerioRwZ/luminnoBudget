import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { quoteRooms, quotes } from "../drizzle/schema";
import { getDb } from "./db";
import { createQuote, dashboardMetrics, getQuote, registerFollowUp } from "./quoteDb";
import { appRouter } from "./routers";

const ids: number[] = [];
afterEach(async () => {
  const db = await getDb();
  if (db && ids.length) {
    await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, ids));
    await db.delete(quotes).where(inArray(quotes.id, ids));
  }
  ids.length = 0;
});

const caller = appRouter.createCaller({ user: { id: 999_002, role: "sales", name: "Vendas", username: "vendas" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });

async function draft() {
  const created = (await createQuote())!;
  ids.push(created.id);
  return { id: created.id, quoteNumber: created.quoteNumber, clientId: null, clientName: "Cliente retorno", professional: "", issueDate: new Date(), validUntil: null, discountMode: "percentage" as const, discountValue: 0, shipping: 0, pixDiscountMode: "percentage" as const, pixDiscountValue: 0, installments: 1, notes: "", rooms: [{ name: "SALA", items: [{ code: "A", shortDescription: "Item", unit: "UN", quantity: 1, unitPrice: 100 }] }] };
}

describe("retornos e motivos de não aprovação", () => {
  it("agenda o retorno ao enviar, registra o contato e limpa ao fechar", async () => {
    const base = await draft();
    const sent = await caller.quote.save({ ...base, status: "open" });
    const days = Math.round((new Date(sent!.followUpAt!).getTime() - Date.now()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(2);
    expect(days).toBeLessThanOrEqual(30);

    const db = (await getDb())!;
    await db.update(quotes).set({ followUpAt: new Date(Date.now() - 2 * 86_400_000) }).where(inArray(quotes.id, [base.id]));
    expect((await dashboardMetrics()).followUps.some((item) => item.id === base.id)).toBe(true);

    await registerFollowUp(base.id, 5);
    expect((await dashboardMetrics()).followUps.some((item) => item.id === base.id)).toBe(false);

    await expect(caller.quote.save({ ...base, status: "lost" })).rejects.toThrow(/motivo/);
    const lost = await caller.quote.save({ ...base, status: "lost", lostReason: "competitor", lostNotes: "12% mais barato" });
    expect(lost).toMatchObject({ followUpAt: null, lostReason: "competitor", lostNotes: "12% mais barato" });
    expect((await dashboardMetrics()).lossReasons.reasons.find((entry) => entry.reason === "competitor")!.count).toBeGreaterThanOrEqual(1);

    const reopened = await caller.quote.save({ ...base, status: "open" });
    expect(reopened).toMatchObject({ lostReason: null, lostNotes: null });
    expect(reopened!.followUpAt).not.toBeNull();
  }, 20_000);

  it("recusa retorno em proposta fechada", async () => {
    const base = await draft();
    await caller.quote.save({ ...base, status: "lost", lostReason: "price" });
    await expect(registerFollowUp(base.id, 3)).rejects.toThrow(/negociação/);
    expect((await getQuote(base.id))!.status).toBe("lost");
  });
});
