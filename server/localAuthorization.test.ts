import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { getLocalUserForAdmin } from "./localUserDb";
import { verifyPassword } from "./localAuth";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contextWith(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("autorização local", () => {
  it("bloqueia rotas de negócio quando não existe sessão autenticada", async () => {
    const caller = appRouter.createCaller(contextWith(null));
    await expect(caller.dashboard()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.product.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("bloqueia o painel administrativo para usuário operacional", async () => {
    const caller = appRouter.createCaller(contextWith({ id: 8, username: "operacional", role: "user", isActive: true } as any));
    await expect(caller.admin.systemStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.admin.listUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("permite que um administrador consulte o status e a lista do painel", async () => {
    const caller = appRouter.createCaller(contextWith({ id: 9, username: "admin", role: "admin", isActive: true } as any));
    await expect(caller.admin.systemStatus()).resolves.toMatchObject({ application: "online" });
    await expect(caller.admin.listUsers()).resolves.toEqual(expect.any(Array));
  });

  it("cria, atualiza e redefine a senha de um usuário pelo painel administrativo", async () => {
    const caller = appRouter.createCaller(contextWith({ id: 10, username: "admin", role: "admin", isActive: true } as any));
    const username = `teste.admin.${Date.now()}`;
    let userId: number | null = null;
    try {
      const created = await caller.admin.createUser({ username, name: "Usuário de Teste", email: "teste@luminno.local", password: "SenhaInicialSegura2026!", role: "user" });
      userId = created.id;
      expect(created).toMatchObject({ username, isActive: true, role: "user" });

      const updated = await caller.admin.updateUser({ id: created.id, name: "Usuário Atualizado", email: "atualizado@luminno.local", role: "user", isActive: true });
      expect(updated).toMatchObject({ id: created.id, name: "Usuário Atualizado", email: "atualizado@luminno.local" });

      await expect(caller.admin.resetPassword({ id: created.id, password: "SenhaRedefinidaSegura2026!" })).resolves.toEqual({ success: true });
      const stored = await getLocalUserForAdmin(created.id);
      await expect(verifyPassword("SenhaRedefinidaSegura2026!", stored?.passwordHash ?? null)).resolves.toBe(true);
    } finally {
      if (userId) {
        const db = await getDb();
        await db?.delete(users).where(eq(users.id, userId));
      }
    }
  });
});
