import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../drizzle/schema";

const scrypt = promisify(scryptCallback);
const HASH_BYTES = 64;
const SESSION_SECONDS = 60 * 60 * 12;

export function getAuthRateLimitSecret() {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_RATE_LIMIT_SECRET ou JWT_SECRET deve possuir ao menos 32 caracteres.");
  }
  return createHash("sha256").update(secret).digest("base64url");
}

export type LocalSession = {
  userId: number;
  username: string;
  role: "user" | "admin";
};

export type SafeUser = {
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  isActive: boolean;
  createdAt: Date;
  lastSignedIn: Date;
};

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET é obrigatório para autenticação local.");
  }
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("JWT_SECRET deve possuir ao menos 32 caracteres para autenticação local.");
  }
  return createHash("sha256").update(secret).digest();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function assertUsername(value: string) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) {
    throw new Error("O usuário deve ter 3 a 80 caracteres: letras, números, ponto, hífen ou sublinhado.");
  }
  return username;
}

export function assertPassword(value: string) {
  if (value.length < 12 || value.length > 200) {
    throw new Error("A senha deve ter entre 12 e 200 caracteres.");
  }
  return value;
}

export async function hashPassword(password: string) {
  const normalized = assertPassword(password);
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(normalized, salt, HASH_BYTES)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, salt, stored] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !stored) return false;
  const derived = (await scrypt(password, salt, HASH_BYTES)) as Buffer;
  const expected = Buffer.from(stored, "base64url");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function signLocalSession(user: User) {
  if (!user.username || !user.isActive) throw new Error("Usuário local inválido para sessão.");
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyLocalSession(token: string): Promise<LocalSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = Number(payload.sub);
    const username = typeof payload.username === "string" ? payload.username : "";
    const role = payload.role === "admin" ? "admin" : payload.role === "user" ? "user" : null;
    if (!Number.isSafeInteger(userId) || userId < 1 || !username || !role) return null;
    return { userId, username, role };
  } catch {
    return null;
  }
}

export function getSessionMaxAgeMs() {
  return SESSION_SECONDS * 1000;
}

export function toSafeUser(user: User): SafeUser {
  if (!user.username) throw new Error("Usuário local sem identificador.");
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    lastSignedIn: user.lastSignedIn,
  };
}
