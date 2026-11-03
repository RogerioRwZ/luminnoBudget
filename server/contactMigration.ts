import { eq, sql } from "drizzle-orm";
import { appKeys } from "../drizzle/schema";
import { normalizeDocument, normalizeEmail, normalizePhone } from "../shared/contact";
import { getDb } from "./db";

// Uma vez só: reformata CPF/CNPJ, telefones e e-mails já gravados para o
// padrão (123.456.789-00, (11) 91234-5678, minúsculas). O que não tem a
// quantidade certa de dígitos fica como está, para correção manual. A data de
// atualização dos registros não muda.
const MARK = "contacts.normalized.v1";
const COLUMNS: Array<{ table: string; columns: Array<["document" | "phone" | "email", (value: string) => string | null]> }> = [
  { table: "clients", columns: [["document", normalizeDocument], ["phone", normalizePhone], ["email", normalizeEmail]] },
  { table: "quotes", columns: [["document", normalizeDocument], ["phone", normalizePhone]] },
  { table: "storeSettings", columns: [["document", normalizeDocument], ["phone", normalizePhone], ["email", normalizeEmail]] },
  { table: "appointments", columns: [["phone", normalizePhone]] },
  { table: "professionals", columns: [["phone", normalizePhone]] },
  { table: "stockLoans", columns: [["phone", normalizePhone]] },
];

export async function normalizeStoredContacts({ force = false } = {}) {
  const db = await getDb();
  if (!db) return 0;
  if (!force && (await db.select().from(appKeys).where(eq(appKeys.name, MARK)).limit(1)).length) return 0;
  let changed = 0;
  for (const { table, columns } of COLUMNS) {
    const names = columns.map(([column]) => sql.identifier(column));
    const [rows] = (await db.execute(sql`SELECT id, ${sql.join(names, sql`, `)} FROM ${sql.identifier(table)}`)) as unknown as [Array<Record<string, unknown>>];
    for (const row of rows) {
      for (const [column, normalize] of columns) {
        const current = row[column];
        if (typeof current !== "string" || !current.trim()) continue;
        const next = normalize(current);
        if (next === null || next === current) continue;
        // updatedAt = updatedAt: mantém a data de atualização do registro.
        await db.execute(sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${next}, updatedAt = updatedAt WHERE id = ${row.id}`);
        changed += 1;
      }
    }
  }
  await db.insert(appKeys).values({ name: MARK, value: new Date().toISOString() }).onDuplicateKeyUpdate({ set: { value: new Date().toISOString() } });
  return changed;
}
