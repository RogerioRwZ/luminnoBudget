import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { clients, quoteItems, quoteRooms, quotes } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { normalizeStoredContacts } from "./contactMigration";

const caller = () => appRouter.createCaller({ user: { id: 999_009, role: "admin", name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });
const created = { clients: [] as number[], quotes: [] as number[] };
afterEach(async () => {
  const db = (await getDb())!;
  if (created.clients.length) await db.delete(clients).where(inArray(clients.id, created.clients));
  if (created.quotes.length) {
    const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(inArray(quoteRooms.quoteId, created.quotes));
    if (rooms.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, rooms.map((room) => room.id)));
    await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, created.quotes));
    await db.delete(quotes).where(inArray(quotes.id, created.quotes));
  }
  Object.assign(created, { clients: [], quotes: [] });
});

describe("CPF/CNPJ, telefone e e-mail", () => {
  it("cliente: recusa número inválido e grava no padrão; a busca acha pelos números", async () => {
    const admin = caller();
    await expect(admin.customers.save({ name: "Inválido", document: "529.982.247-24" })).rejects.toThrow(/CPF inválido/);
    await expect(admin.customers.save({ name: "Inválido", phone: "11 8123-45678" })).rejects.toThrow(/começar com 9/);
    await expect(admin.customers.save({ name: "Inválido", email: "maria@email" })).rejects.toThrow(/E-mail inválido/);

    const name = `Cliente contato ${Date.now()}`;
    const id = await admin.customers.save({ name, document: "52998224725", phone: "+55 11 91234-5678", email: "  Maria@Email.COM " });
    created.clients.push(id);
    const saved = (await admin.customers.list({ search: "52998224725" })).find((row) => row.id === id)!;
    expect(saved).toMatchObject({ document: "529.982.247-25", phone: "(11) 91234-5678", email: "maria@email.com" });
    expect((await admin.customers.list({ search: "11912345678" })).some((row) => row.id === id)).toBe(true);
    // CNPJ com letras (padrão da Receita desde julho de 2026).
    await admin.customers.save({ id, name, document: "12abc34501de35" });
    expect((await admin.customers.list({ search: "12ABC345" })).find((row) => row.id === id)?.document).toBe("12.ABC.345/01DE-35");
  });

  it("orçamento: formata o que está completo e não trava o que ainda está sendo digitado", async () => {
    const admin = caller();
    const quote = (await admin.quote.create())!;
    created.quotes.push(quote.id);
    const draft = { id: quote.id, clientName: "Ana", professional: "", status: "draft" as const, issueDate: new Date(), discountMode: "percentage" as const, discountValue: 0, shipping: 0, pixDiscountMode: "percentage" as const, pixDiscountValue: 0, installments: 1, rooms: [{ name: "Sala", items: [{ productId: null, code: "S", shortDescription: "Serviço", unit: "UN", quantity: 1, unitPrice: 10 }] }] };
    let saved = await admin.quote.save({ ...draft, document: "11222333000181", phone: "1131234567" });
    expect(saved).toMatchObject({ document: "11.222.333/0001-81", phone: "(11) 3123-4567" });
    saved = await admin.quote.save({ ...draft, document: "529.98", phone: "(11) 9123" });
    expect(saved).toMatchObject({ document: "529.98", phone: "(11) 9123" });
  });

  it("reformata os contatos antigos sem mudar a data de atualização", async () => {
    const db = (await getDb())!;
    const updatedAt = new Date(2025, 0, 10, 12);
    const [row] = await db.insert(clients).values({ name: `Antigo ${Date.now()}`, professional: "", document: "529 982 247 25", phone: "11 99999-0000", email: "ANTIGO@Email.com", createdAt: updatedAt, updatedAt }).$returningId();
    created.clients.push(row!.id);
    await normalizeStoredContacts({ force: true });
    const after = (await db.select().from(clients).where(eq(clients.id, row!.id)))[0]!;
    expect(after).toMatchObject({ document: "529.982.247-25", phone: "(11) 99999-0000", email: "antigo@email.com" });
    expect(after.updatedAt.getTime()).toBe(updatedAt.getTime());
  });
});
