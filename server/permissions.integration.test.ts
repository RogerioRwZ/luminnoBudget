import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

const caller = (role: "sales" | "stock" | "finance" | "user") =>
  appRouter.createCaller({ user: { id: 999_001, role, name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });

describe("permissões no servidor", () => {
  it("bloqueia áreas fora do perfil, com mensagem clara", async () => {
    await expect(caller("sales").finance.overview()).rejects.toThrow(/não tem acesso/);
    await expect(caller("sales").inventory.purchases()).rejects.toThrow(/não tem acesso/);
    await expect(caller("stock").quote.create()).rejects.toThrow(/não tem acesso/);
    await expect(caller("finance").inventory.overview()).rejects.toThrow(/não tem acesso/);
  });

  it("libera o que o perfil usa e tira os valores recebidos do painel de quem não é do financeiro", async () => {
    await expect(caller("stock").inventory.purchases()).resolves.toBeInstanceOf(Array);
    await expect(caller("sales").product.list()).resolves.toBeInstanceOf(Array);
    const dashboard = await caller("stock").dashboard();
    expect(dashboard.finance).toBeNull();
    expect(dashboard.monthly.every((month) => month.received === 0)).toBe(true);
    expect((await caller("user").dashboard()).finance).not.toBeNull();
  });
});
