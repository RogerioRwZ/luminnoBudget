import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { financePayments, financeReceivables, quoteItemReservations, quoteItems, quoteRooms, quotes } from "../drizzle/schema";
import { getDb } from "./db";
import { createQuote, listQuotesPaged, saveQuote } from "./quoteDb";

let createdQuoteIds: number[] = [];

async function removeCreatedQuotes() {
  const db = await getDb();
  if (!db || !createdQuoteIds.length) return;
  const receivables = await db.select({ id: financeReceivables.id }).from(financeReceivables).where(inArray(financeReceivables.quoteId, createdQuoteIds));
  const receivableIds = receivables.map((row) => row.id);
  if (receivableIds.length) await db.delete(financePayments).where(inArray(financePayments.receivableId, receivableIds));
  await db.delete(financeReceivables).where(inArray(financeReceivables.quoteId, createdQuoteIds));
  await db.delete(quoteItemReservations).where(inArray(quoteItemReservations.quoteId, createdQuoteIds));
  const rooms = await db.select({ id: quoteRooms.id }).from(quoteRooms).where(inArray(quoteRooms.quoteId, createdQuoteIds));
  const roomIds = rooms.map((room) => room.id);
  if (roomIds.length) await db.delete(quoteItems).where(inArray(quoteItems.quoteRoomId, roomIds));
  await db.delete(quoteRooms).where(inArray(quoteRooms.quoteId, createdQuoteIds));
  await db.delete(quotes).where(inArray(quotes.id, createdQuoteIds));
  createdQuoteIds = [];
}

describe("listQuotesPaged (busca, filtro e paginação combinados no servidor)", () => {
  afterEach(removeCreatedQuotes);

  it("busca em todo o histórico antes de paginar, e pagina corretamente o resultado filtrado", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const marker = `PagTeste${suffix}`;

    // Cria 5 orçamentos que combinam com a busca (marcador único no nome do
    // cliente) e 1 que NÃO combina — para garantir que o filtro realmente
    // restringe o resultado antes de paginar.
    const specs = [
      { clientName: `${marker} Alice`, status: "open" as const },
      { clientName: `${marker} Bruno`, status: "open" as const },
      { clientName: `${marker} Carla`, status: "approved" as const },
      { clientName: `${marker} Diego`, status: "lost" as const },
      { clientName: `${marker} Elis`, status: "open" as const },
      { clientName: "Outro cliente qualquer, sem o marcador", status: "open" as const },
    ];

    for (const spec of specs) {
      const created = await createQuote();
      createdQuoteIds.push(created.id!);
      await saveQuote({
        ...created,
        clientName: spec.clientName,
        status: spec.status,
        discountValue: Number(created.discountValue),
        shipping: Number(created.shipping),
        pixDiscountValue: Number(created.pixDiscountValue),
        rooms: [
          {
            name: "GERAL",
            items: [
              {
                code: "TESTE",
                shortDescription: "Item de teste de paginação",
                unit: "UN",
                quantity: 1,
                unitPrice: 100,
              },
            ],
          },
        ],
      });
    }

    // Página 1 de 2 (tamanho 2): deve conter só 2 dos 5 que combinam com a
    // busca, e o total deve refletir TODOS os 5 que combinam (não só a
    // página atual).
    const page1 = await listQuotesPaged({ search: marker, page: 1, pageSize: 2 });
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.quotes).toHaveLength(2);
    expect(page1.quotes.every((quote) => quote.clientName.includes(marker))).toBe(true);

    // Página 3 (última): deve trazer o restante (1 item), sem repetir os
    // clientes já vistos nas páginas anteriores.
    const page2 = await listQuotesPaged({ search: marker, page: 2, pageSize: 2 });
    const page3 = await listQuotesPaged({ search: marker, page: 3, pageSize: 2 });
    expect(page3.quotes).toHaveLength(1);
    const allSeenIds = [...page1.quotes, ...page2.quotes, ...page3.quotes].map((quote) => quote.id);
    expect(new Set(allSeenIds).size).toBe(5);

    // Combinando busca com filtro de status: só "Carla" está aprovada.
    const approvedOnly = await listQuotesPaged({ search: marker, status: "approved", page: 1, pageSize: 10 });
    expect(approvedOnly.total).toBe(1);
    expect(approvedOnly.quotes[0]?.clientName).toContain("Carla");

    // O cliente sem o marcador nunca aparece nos resultados da busca.
    const noneShouldMatch = [...page1.quotes, ...page2.quotes, ...page3.quotes].some(
      (quote) => !quote.clientName.includes(marker)
    );
    expect(noneShouldMatch).toBe(false);
  });

  it("nunca devolve uma página além da última (mesmo se pedirem uma página inexistente)", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const marker = `PagLimite${suffix}`;
    const created = await createQuote();
    createdQuoteIds.push(created.id!);
    await saveQuote({ ...created, clientName: marker, status: "open", discountValue: Number(created.discountValue), shipping: Number(created.shipping), pixDiscountValue: Number(created.pixDiscountValue) });

    const result = await listQuotesPaged({ search: marker, page: 999, pageSize: 10 });
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.quotes).toHaveLength(1);
  });
});
