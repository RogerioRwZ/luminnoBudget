import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { createInitialAdminUser } from "./localUserDb";

const temporaryUserIds: number[] = [];

afterEach(async () => {
  const db = await getDb();
  await Promise.all(temporaryUserIds.splice(0).map((id) => db?.delete(users).where(eq(users.id, id))));
});

describe("createInitialAdminUser (configuração inicial concorrente)", () => {
  it("cria no máximo um administrador quando várias requisições de setup chegam ao mesmo tempo", async () => {
    const suffix = Date.now();
    const attempts = Array.from({ length: 6 }, (_, i) =>
      createInitialAdminUser({
        username: `setup-concorrente-${suffix}-${i}`,
        name: `Tentativa ${i}`,
        password: "SenhaDeTesteBemSegura2026!",
      }).then(
        (user) => ({ ok: true as const, user }),
        (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) })
      )
    );

    const results = await Promise.all(attempts);
    const successes = results.filter((result) => result.ok);
    successes.forEach((result) => temporaryUserIds.push(result.user.id));

    // Não importa se a tabela já tinha administradores de outro teste
    // rodando em paralelo: o que nunca pode acontecer é MAIS DE UMA destas
    // 6 tentativas concorrentes ser aceita como "a" configuração inicial.
    expect(successes.length).toBeLessThanOrEqual(1);

    const failures = results.filter((result) => !result.ok);
    failures.forEach((result) => {
      if (!result.ok) expect(result.message).toBeTruthy();
    });
  });
});
