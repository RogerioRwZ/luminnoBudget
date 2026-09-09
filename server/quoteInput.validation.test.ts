import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { quotes } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function contextWith(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

// Sessão "fake" para o contexto do teste — valor bem acima de qualquer
// auto-incremento real da tabela `users`, pelo mesmo motivo explicado em
// localAuthorization.test.ts.
const caller = appRouter.createCaller(
  contextWith({ id: 999_999_004, username: "teste.validacao", role: "admin", isActive: true } as any)
);

function baseQuoteInput(overrides: Record<string, unknown> = {}) {
  return {
    quoteNumber: Math.floor(Date.now() % 1_000_000) + Math.floor(Math.random() * 1000),
    clientName: "Cliente de teste",
    professional: "Profissional de teste",
    status: "draft" as const,
    issueDate: new Date(),
    discountMode: "percentage" as const,
    discountValue: 0,
    shipping: 0,
    pixDiscountMode: "percentage" as const,
    pixDiscountValue: 0,
    installments: 6,
    rooms: [
      {
        name: "SALA",
        items: [
          {
            code: "1",
            shortDescription: "Item de teste",
            unit: "UN",
            quantity: 1,
            unitPrice: 10,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("validação do servidor para quote.save (defesa em profundidade)", () => {
  it("rejeita um item sem descrição, mesmo chamando a API diretamente", async () => {
    await expect(
      caller.quote.save(
        baseQuoteInput({
          rooms: [{ name: "SALA", items: [{ code: "1", shortDescription: "   ", unit: "UN", quantity: 1, unitPrice: 10 }] }],
        }) as any
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejeita quantidade × valor unitário além do que a coluna do banco comporta, mesmo com cada campo isoladamente dentro do limite", async () => {
    // quantity (99999) e unitPrice (99999999) estão cada um dentro do
    // próprio limite individual, mas multiplicados ultrapassam o que a
    // coluna decimal(12,2) do banco realmente comporta.
    await expect(
      caller.quote.save(
        baseQuoteInput({
          rooms: [{ name: "SALA", items: [{ code: "1", shortDescription: "Item", unit: "UN", quantity: 99999, unitPrice: 99999999 }] }],
        }) as any
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("aceita um orçamento válido normalmente (garantindo que as novas validações não bloqueiam casos legítimos)", async () => {
    const created = await caller.quote.save(baseQuoteInput() as any);
    expect(created).toBeTruthy();
    try {
      expect(created!.clientName).toBe("Cliente de teste");
    } finally {
      if (created) await (await import("./db")).getDb().then((db) => db?.delete(quotes).where(eq(quotes.id, created.id)));
    }
  });
});
