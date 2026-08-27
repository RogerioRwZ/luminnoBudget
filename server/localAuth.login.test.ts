import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { users } from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { resetLoginRateLimitForTests } from "./loginRateLimit";
import { createLocalUser, type LocalDatabaseUser } from "./localUserDb";
import { verifyLocalSession } from "./localAuth";
import { appRouter } from "./routers";

const VALID_RATE_LIMIT_SECRET = "test-rate-limit-secret-32-characters-long";
const VALID_SESSION_SECRET = "test-local-session-secret-32-characters-long";
const previousAuthRateLimitSecret = process.env.AUTH_RATE_LIMIT_SECRET;
const previousJwtSecret = process.env.JWT_SECRET;
const temporaryUserIds: number[] = [];

type CookieCall = { name: string; value: string; options: Record<string, unknown> };

function createAnonymousContext() {
  const cookies: CookieCall[] = [];
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => cookies.push({ name, value, options }),
    } as TrpcContext["res"],
  };
  return { ctx, cookies };
}

async function removeTemporaryUsers() {
  const db = await getDb();
  await Promise.all(temporaryUserIds.splice(0).map((id) => db?.delete(users).where(eq(users.id, id))));
}

describe("auth.login local", () => {
  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_SECRET = VALID_RATE_LIMIT_SECRET;
    process.env.JWT_SECRET = VALID_SESSION_SECRET;
    resetLoginRateLimitForTests();
  });

  afterEach(async () => {
    await removeTemporaryUsers();
    if (previousAuthRateLimitSecret === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET;
    else process.env.AUTH_RATE_LIMIT_SECRET = previousAuthRateLimitSecret;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    resetLoginRateLimitForTests();
  });

  it("emite uma sessão HTTP-only quando o login usa uma chave de rate limit válida", async () => {
    const username = `login.teste.${Date.now()}`;
    const password = "SenhaDeTesteSegura2026!";
    const created = await createLocalUser({ username, name: "Usuário de teste", password, role: "user" });
    temporaryUserIds.push(created.id);
    const { ctx, cookies } = createAnonymousContext();

    const result = await appRouter.createCaller(ctx).auth.login({ username, password });

    expect(result).toMatchObject({ id: created.id, username, isActive: true });
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: COOKIE_NAME,
      options: { httpOnly: true, path: "/", sameSite: "lax", secure: true },
    });
    await expect(verifyLocalSession(cookies[0]!.value)).resolves.toEqual({ userId: created.id, username, role: "user" });
  });

  it("recusa o procedimento no ponto de entrada quando a chave de rate limit é inválida", async () => {
    process.env.AUTH_RATE_LIMIT_SECRET = "curta";
    const { ctx } = createAnonymousContext();

    await expect(appRouter.createCaller(ctx).auth.login({ username: "usuario.teste", password: "SenhaDeTesteSegura2026!" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringContaining("ao menos 32 caracteres"),
    });
  });
});
