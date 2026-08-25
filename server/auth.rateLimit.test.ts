import { beforeEach, describe, expect, it } from "vitest";
import { getAuthRateLimitSecret } from "./localAuth";
import { assertLoginAllowed, clearLoginFailures, registerLoginFailure, resetLoginRateLimitForTests } from "./loginRateLimit";

describe("auth rate-limit secret", () => {
  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_SECRET = "test-rate-limit-secret-32-characters-long";
    resetLoginRateLimitForTests();
  });

  it("disponibiliza um segredo forte para proteger o limitador", () => {
    const previous = process.env.AUTH_RATE_LIMIT_SECRET;
    process.env.AUTH_RATE_LIMIT_SECRET = "test-rate-limit-secret-32-characters-long";
    expect(getAuthRateLimitSecret()).toHaveLength(43);
    if (previous === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET;
    else process.env.AUTH_RATE_LIMIT_SECRET = previous;
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
