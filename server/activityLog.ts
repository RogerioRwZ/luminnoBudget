import { and, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import { activityLog } from "../drizzle/schema";
import { getDb } from "./db";

export type ActivityEntity = "quote" | "product" | "finance" | "stock" | "settings" | "user" | "auth" | "backup" | "message" | "customer" | "appointment" | "aftersales";

export type ActivityActor = { id: number; name: string | null; username?: string | null } | null;

export type ActivityEntry = {
  action: string;
  entityType: ActivityEntity;
  entityId?: number | null;
  summary: string;
  details?: Record<string, unknown> | null;
};

type RequestLike = { ip?: string; socket?: { remoteAddress?: string } } | undefined;

// Registra uma atividade. Nunca lança erro: uma falha no registro não pode
// desfazer nem bloquear a operação que já foi concluída.
export async function recordActivity(actor: ActivityActor, entry: ActivityEntry, req?: RequestLike) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(activityLog).values({
      userId: actor?.id ?? null,
      userName: (actor?.name || actor?.username || null)?.slice(0, 240) ?? null,
      action: entry.action.slice(0, 64),
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 512),
      details: entry.details ? JSON.stringify(entry.details) : null,
      ip: (req?.ip || req?.socket?.remoteAddress || null)?.slice(0, 64) ?? null,
    });
  } catch (error) {
    console.error("[activityLog] falha ao registrar atividade:", error);
  }
}

export type ActivityFilters = {
  entityType?: ActivityEntity;
  userId?: number;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listActivity(filters: ActivityFilters = {}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  const conditions = [];
  if (filters.entityType) conditions.push(eq(activityLog.entityType, filters.entityType));
  if (filters.userId) conditions.push(eq(activityLog.userId, filters.userId));
  if (filters.from) conditions.push(gte(activityLog.createdAt, filters.from));
  if (filters.to) conditions.push(lt(activityLog.createdAt, filters.to));
  const term = filters.search?.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    conditions.push(or(like(activityLog.summary, pattern), like(activityLog.userName, pattern))!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(activityLog).where(where);
  const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
  const page = Math.min(totalPages, Math.max(1, filters.page ?? 1));
  const rows = await db.select().from(activityLog).where(where).orderBy(desc(activityLog.createdAt), desc(activityLog.id)).limit(pageSize).offset((page - 1) * pageSize);
  return {
    entries: rows.map((row) => ({ ...row, details: parseDetails(row.details) })),
    total: Number(total),
    page,
    pageSize,
    totalPages,
  };
}

function parseDetails(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
export const formatActivityMoney = currency;

// Lista os campos alterados entre duas versões de um registro.
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields: Array<keyof T>) {
  const changes: Record<string, { de: unknown; para: unknown }> = {};
  for (const fieldName of fields) {
    if (!(fieldName in after)) continue;
    const previous = before[fieldName];
    const next = after[fieldName];
    const same = typeof previous === "number" || typeof next === "number" || /^\d+(\.\d+)?$/.test(String(previous ?? ""))
      ? Number(previous ?? 0) === Number(next ?? 0)
      : String(previous ?? "") === String(next ?? "");
    if (!same) changes[String(fieldName)] = { de: previous ?? null, para: next ?? null };
  }
  return changes;
}
