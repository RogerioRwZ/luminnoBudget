import { beforeEach, describe, expect, it } from "vitest";
import { afterAll } from "vitest";
import { getAuthRateLimitSecret } from "./localAuth";
import { assertLoginAllowed, clearLoginFailures, registerLoginFailure, resetLoginRateLimitForTests } from "./loginRateLimit";

const VALID_SECRET = "test-rate-limit-secret-32-characters-long";
const previousAuthRateLimitSecret = process.env.AUTH_RATE_LIMIT_SECRET;
const previousJwtSecret = process.env.JWT_SECRET;

describe("auth rate-limit secret", () => {
  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_SECRET = VALID_SECRET;
    process.env.JWT_SECRET = "test-jwt-secret-32-characters-long";
    resetLoginRateLimitForTests();
  });

  afterAll(() => {
    if (previousAuthRateLimitSecret === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET;
    else process.env.AUTH_RATE_LIMIT_SECRET = previousAuthRateLimitSecret;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  it("disponibiliza um segredo forte para proteger o limitador", () => {
    process.env.AUTH_RATE_LIMIT_SECRET = VALID_SECRET;
    expect(getAuthRateLimitSecret()).toHaveLength(43);
  });

  it("rejeita chaves ausentes ou curtas antes de calcular o identificador do rate limit", () => {
    process.env.AUTH_RATE_LIMIT_SECRET = "curta";
    expect(() => getAuthRateLimitSecret()).toThrow("ao menos 32 caracteres");

    delete process.env.AUTH_RATE_LIMIT_SECRET;
    process.env.JWT_SECRET = "curta";
    expect(() => getAuthRateLimitSecret()).toThrow("ao menos 32 caracteres");
  });

  it("bloqueia a sexta tentativa e libera depois de limpar a chave", () => {
    resetLoginRateLimitForTests();
    const now = 1_700_000_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) registerLoginFailure("ana", "127.0.0.1", now);
    expect(() => assertLoginAllowed("ana", "127.0.0.1", now)).toThrow("Muitas tentativas");
    clearLoginFailures("ana", "127.0.0.1");
    expect(() => assertLoginAllowed("ana", "127.0.0.1", now)).not.toThrow();
  });
});
