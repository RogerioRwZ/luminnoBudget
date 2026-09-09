import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { randomUUID } from "node:crypto";
import { users, type User } from "../drizzle/schema";
import { getDb } from "./db";
import { assertUsername, hashPassword, normalizeUsername, toSafeUser, type SafeUser } from "./localAuth";

const localUserFilter = eq(users.loginMethod, "local");
const INITIAL_ADMIN_SETUP_LOCK = "luminno_initial_admin_setup";

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

// Cria o primeiro administrador (configuração inicial). Diferente de
// createLocalUser, isto precisa ser atômico em relação à checagem "ainda
// não existe nenhum usuário": duas requisições concorrentes de setup (ex.:
// dois visitantes acessando o app recém-implantado ao mesmo tempo, cada um
// com um nome de usuário diferente) poderiam, sem essa atomicidade, passar
// juntas pela checagem e criar dois administradores distintos — quebrando
// a garantia de que só a primeira pessoa a chegar vira admin. Um lock
// nomeado do MySQL (GET_LOCK) serializa a checagem+criação entre conexões
// mesmo quando a tabela de usuários está totalmente vazia, cenário em que
// um `SELECT ... FOR UPDATE` não travaria nada por não haver linhas.
//
// A conexão é controlada manualmente (em vez de usar db.transaction) para
// garantir que RELEASE_LOCK só aconteça DEPOIS do COMMIT: se o lock fosse
// liberado antes do commit (ex.: dentro de um `finally` de uma transação
// do drizzle, que faz o commit só depois do callback retornar), a próxima
// requisição em espera poderia obter o lock e ler o banco antes da
// inserção anterior estar de fato visível — reabrindo exatamente a mesma
// corrida que o lock deveria impedir.
export async function createInitialAdminUser(input: Omit<CreateLocalUserInput, "role">): Promise<SafeUser> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const username = assertUsername(input.username);
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const pool = db.$client.promise();
  const connection = await pool.getConnection();
  try {
    const session = drizzle(connection);
    await connection.query("BEGIN");
    await connection.query("SELECT GET_LOCK(?, 10)", [INITIAL_ADMIN_SETUP_LOCK]);
    try {
      const existingCount = await session.select({ count: sql<number>`count(*)` }).from(users).where(localUserFilter);
      if (Number(existingCount[0]?.count ?? 0) > 0) {
        throw new Error("A configuração inicial já foi concluída.");
      }
      const existingUsername = await session.select().from(users).where(and(localUserFilter, eq(users.username, username))).limit(1);
      if (existingUsername[0]) throw new Error("Este nome de usuário já está em uso.");
      const record = {
        openId: `local_${randomUUID()}`,
        username,
        name: input.name.trim(),
        email: input.email?.trim() || null,
        loginMethod: "local",
        passwordHash,
        role: "admin" as const,
        isActive: true,
        lastSignedIn: now,
      } as const;
      await session.insert(users).values(record);
      const created = await session.select().from(users).where(and(localUserFilter, eq(users.username, username))).limit(1);
      if (!created[0]) throw new Error("Não foi possível criar o usuário.");
      await connection.query("COMMIT");
      return toSafeUser(created[0]);
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      // Só libera o lock depois que o commit (ou rollback) já aconteceu.
      await connection.query("SELECT RELEASE_LOCK(?)", [INITIAL_ADMIN_SETUP_LOCK]);
    }
  } finally {
    connection.release();
  }
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
