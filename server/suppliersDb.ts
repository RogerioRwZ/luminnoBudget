import { asc, eq, sql } from "drizzle-orm";
import { afterSalesCases, products, suppliers } from "../drizzle/schema";
import { getDb, LOCKED_READS } from "./db";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

export async function listSuppliers() {
  const db = await database();
  const [rows, counts] = await Promise.all([
    db.select().from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ name: products.supplierName, total: sql<number>`count(*)` }).from(products).groupBy(products.supplierName),
  ]);
  const key = (name: string) => name.toLocaleLowerCase("pt-BR");
  const totals = new Map(counts.flatMap((row) => (row.name ? [[key(row.name), Number(row.total)] as const] : [])));
  return rows.map((row) => ({ id: row.id, name: row.name, productCount: totals.get(key(row.name)) ?? 0 }));
}

// Cadastra se ainda não existir; o banco não diferencia maiúsculas nem acentos.
export async function ensureSupplier(name: string | null | undefined) {
  const clean = (name ?? "").trim();
  if (!clean) return;
  const db = await database();
  await db.insert(suppliers).values({ name: clean }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
}

export async function renameSupplier(id: number, name: string) {
  const db = await database();
  const clean = name.trim();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${suppliers} WHERE ${eq(suppliers.id, id)} FOR UPDATE`);
    const current = (await tx.select().from(suppliers).where(eq(suppliers.id, id)).limit(1))[0];
    if (!current) throw new Error("Fornecedor não encontrado.");
    const taken = (await tx.select().from(suppliers).where(eq(suppliers.name, clean)).limit(1))[0];
    if (taken && taken.id !== id) throw new Error(`Já existe o fornecedor ${taken.name}.`);
    await tx.update(suppliers).set({ name: clean }).where(eq(suppliers.id, id));
    await tx.update(products).set({ supplierName: clean }).where(eq(products.supplierName, current.name));
    await tx.update(afterSalesCases).set({ supplierName: clean }).where(eq(afterSalesCases.supplierName, current.name));
    return { before: current.name, name: clean };
  }, LOCKED_READS);
}
