import { createHash } from "node:crypto";
import { getAuthRateLimitSecret } from "./localAuth";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;
// Limite adicional por IP, independente do usuário: impede que um único
// endereço teste uma senha comum contra muitos nomes de usuário diferentes
// (password spraying), o que o limite por usuário+IP sozinho não pega.
const MAX_FAILURES_PER_IP = 30;
const MAX_TRACKED_KEYS = 10_000;

type FailureState = { failures: number; windowStartedAt: number; blockedUntil: number };
const failures = new Map<string, FailureState>();

function keyFor(username: string, ip: string) {
  const secret = getAuthRateLimitSecret();
  return createHash("sha256").update(`${secret}:${username.trim().toLowerCase()}:${ip}`).digest("hex");
}

function ipKeyFor(ip: string) {
  return keyFor("\u0000ip", ip);
}

function isBlocked(key: string, now: number) {
  const state = failures.get(key);
  if (!state) return false;
  if (state.blockedUntil > now) return true;
  if (now - state.windowStartedAt >= WINDOW_MS && state.blockedUntil <= now) failures.delete(key);
  return false;
}

// Remove entradas expiradas para o mapa não crescer sem limite com
// tentativas de muitos IPs/usuários diferentes.
function prune(now: number) {
  if (failures.size < MAX_TRACKED_KEYS) return;
  failures.forEach((state, key) => {
    if (state.blockedUntil <= now && now - state.windowStartedAt >= WINDOW_MS) failures.delete(key);
  });
  if (failures.size >= MAX_TRACKED_KEYS) {
    const oldest = Array.from(failures.entries()).sort((a, b) => a[1].windowStartedAt - b[1].windowStartedAt);
    oldest.slice(0, Math.ceil(MAX_TRACKED_KEYS / 10)).forEach(([key]) => failures.delete(key));
  }
}

function bump(key: string, limit: number, now: number) {
  const current = failures.get(key);
  const state = !current || now - current.windowStartedAt >= WINDOW_MS
    ? { failures: 1, windowStartedAt: now, blockedUntil: 0 }
    : { ...current, failures: current.failures + 1 };
  if (state.failures >= limit) state.blockedUntil = now + BLOCK_MS;
  failures.set(key, state);
}

export function assertLoginAllowed(username: string, ip: string, now = Date.now()) {
  const blocked = isBlocked(keyFor(username, ip), now) || isBlocked(ipKeyFor(ip), now);
  if (blocked) throw new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
}

export function registerLoginFailure(username: string, ip: string, now = Date.now()) {
  prune(now);
  bump(keyFor(username, ip), MAX_FAILURES, now);
  bump(ipKeyFor(ip), MAX_FAILURES_PER_IP, now);
}

export function clearLoginFailures(username: string, ip: string) {
  failures.delete(keyFor(username, ip));
}

export function resetLoginRateLimitForTests() {
  failures.clear();
}

export const loginRateLimitConfig = { windowMs: WINDOW_MS, maxFailures: MAX_FAILURES, maxFailuresPerIp: MAX_FAILURES_PER_IP, blockMs: BLOCK_MS } as const;
