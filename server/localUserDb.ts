import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { users, type User } from "../drizzle/schema";
import { getDb } from "./db";
import { assertUsername, hashPassword, normalizeUsername, toSafeUser, type SafeUser } from "./localAuth";

const localUserFilter = eq(users.loginMethod, "local");

export async function countLocalUsers() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const result = await db.select({ count: sql<number>`count(*)` }).from(users).where(localUserFilter);
  return Number(result[0]?.count ?? 0);
}

export async function countActiveLocalAdmins() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(localUserFilter, eq(users.role, "admin"), eq(users.isActive, true)));
  return Number(result[0]?.count ?? 0);
}

export async function getLocalUserByUsername(usernameInput: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const username = normalizeUsername(usernameInput);
  const rows = await db
    .select()
    .from(users)
    .where(and(localUserFilter, eq(users.username, username)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveLocalUserById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const rows = await db
    .select()
    .from(users)
    .where(and(localUserFilter, eq(users.id, id), eq(users.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLocalUserForAdmin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const rows = await db.select().from(users).where(and(localUserFilter, eq(users.id, id))).limit(1);
  return rows[0] ?? null;
}

type CreateLocalUserInput = {
  username: string;
  name: string;
  email?: string | null;
  password: string;
  role: "user" | "admin";
};

export async function createLocalUser(input: CreateLocalUserInput): Promise<SafeUser> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const username = assertUsername(input.username);
  const existing = await getLocalUserByUsername(username);
  if (existing) throw new Error("Este nome de usuário já está em uso.");
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const record = {
    openId: `local_${randomUUID()}`,
    username,
    name: input.name.trim(),
    email: input.email?.trim() || null,
    loginMethod: "local",
    passwordHash,
    role: input.role,
    isActive: true,
    lastSignedIn: now,
  } as const;
  await db.insert(users).values(record);
  const created = await getLocalUserByUsername(username);
  if (!created) throw new Error("Não foi possível criar o usuário.");
  return toSafeUser(created);
}

export async function listLocalUsers(): Promise<SafeUser[]> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const rows = await db.select().from(users).where(localUserFilter).orderBy(asc(users.username));
  return rows.map(toSafeUser);
}

export async function markLocalUserSignedIn(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  await db.update(users).set({ lastSignedIn: new Date() }).where(and(localUserFilter, eq(users.id, id)));
}

export async function updateLocalUser(
  id: number,
  input: { name: string; email?: string | null; role: "user" | "admin"; isActive: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  await db
    .update(users)
    .set({ name: input.name.trim(), email: input.email?.trim() || null, role: input.role, isActive: input.isActive })
    .where(and(localUserFilter, eq(users.id, id)));
  const updated = await getLocalUserForAdmin(id);
  if (!updated) throw new Error("Usuário não encontrado.");
  return toSafeUser(updated);
}

export async function resetLocalUserPassword(id: number, password: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const target = await getLocalUserForAdmin(id);
  if (!target) throw new Error("Usuário não encontrado.");
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(and(localUserFilter, eq(users.id, id)));
}

export async function verifyDatabaseConnection() {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export type LocalDatabaseUser = User;
