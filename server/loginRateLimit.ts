import { createHash } from "node:crypto";
import { getAuthRateLimitSecret } from "./localAuth";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;

type FailureState = { failures: number; windowStartedAt: number; blockedUntil: number };
const failures = new Map<string, FailureState>();

function keyFor(username: string, ip: string) {
  const secret = getAuthRateLimitSecret();
  return createHash("sha256").update(`${secret}:${username.trim().toLowerCase()}:${ip}`).digest("hex");
}

export function assertLoginAllowed(username: string, ip: string, now = Date.now()) {
  const key = keyFor(username, ip);
  const state = failures.get(key);
  if (!state) return;
  if (state.blockedUntil > now) throw new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  if (now - state.windowStartedAt >= WINDOW_MS) failures.delete(key);
}

export function registerLoginFailure(username: string, ip: string, now = Date.now()) {
  const key = keyFor(username, ip);
  const current = failures.get(key);
  const state = !current || now - current.windowStartedAt >= WINDOW_MS
    ? { failures: 1, windowStartedAt: now, blockedUntil: 0 }
    : { ...current, failures: current.failures + 1 };
  if (state.failures >= MAX_FAILURES) state.blockedUntil = now + BLOCK_MS;
  failures.set(key, state);
}

export function clearLoginFailures(username: string, ip: string) {
  failures.delete(keyFor(username, ip));
}

export function resetLoginRateLimitForTests() {
  failures.clear();
}

export const loginRateLimitConfig = { windowMs: WINDOW_MS, maxFailures: MAX_FAILURES, blockMs: BLOCK_MS } as const;
