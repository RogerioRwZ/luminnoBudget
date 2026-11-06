import { eq } from "drizzle-orm";
import { products } from "../drizzle/schema";
import { getDb } from "./db";
import { getProduct, saveProduct } from "./quoteDb";
import { ensureSupplier } from "./suppliersDb";
import { normalizeReference } from "../shared/productCodes";

export function isDuplicateEntry(error: unknown) {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  const mysqlError = cause as { code?: string; errno?: number } | null;
  return mysqlError?.code === "ER_DUP_ENTRY" || mysqlError?.errno === 1062;
}

export type ImportInput = {
  line: number;
  reference: string;
  shortDescription?: string;
  fullDescription?: string;
  barcode?: string;
  unit?: string;
  supplierName?: string;
  unitPrice?: number;
  costPrice?: number;
  initialStock?: number;
  reorderPoint?: number;
  warrantyMonths?: number;
  active?: boolean;
  imageUrl?: string;
  imageKey?: string;
};
export type ImportResult = { line: number; reference: string; status: "created" | "updated" | "skipped" | "error"; message?: string; priceChange?: { de: number; para: number } };

// Cada linha é uma gravação: a linha com erro não derruba as outras. Ao
// atualizar, célula vazia mantém o que está gravado e o estoque não muda.
export async function importProductRow(row: ImportInput, mode: "skip" | "update", access: { canSeeCost: boolean; canStock: boolean; responsible: string | null }): Promise<ImportResult> {
  const reference = normalizeReference(row.reference);
  const base = { line: row.line, reference };
  try {
    const db = await getDb();
    if (!db) throw new Error("Banco de dados indisponível.");
    const found = (await db.select({ id: products.id }).from(products).where(eq(products.reference, reference)).limit(1))[0];
    const costPrice = access.canSeeCost ? row.costPrice : undefined;
    if (found) {
      if (mode === "skip") return { ...base, status: "skipped", message: "Já existe no catálogo." };
      const current = (await getProduct(found.id))!;
      await saveProduct({
        id: found.id,
        reference,
        shortDescription: row.shortDescription ?? current.shortDescription,
        fullDescription: row.fullDescription ?? current.fullDescription,
        imageUrl: row.imageUrl ?? current.imageUrl,
        imageKey: row.imageKey ?? current.imageKey,
        barcode: row.barcode,
        unit: row.unit ?? current.unit,
        supplierName: row.supplierName ?? current.supplierName,
        unitPrice: row.unitPrice ?? Number(current.unitPrice),
        costPrice,
        reorderPoint: row.reorderPoint ?? Number(current.reorderPoint),
        warrantyMonths: row.warrantyMonths,
        active: row.active ?? current.active,
      });
      await ensureSupplier(row.supplierName);
      const price = row.unitPrice;
      return { ...base, status: "updated", ...(price !== undefined && price !== Number(current.unitPrice) ? { priceChange: { de: Number(current.unitPrice), para: price } } : {}) };
    }
    if (!row.shortDescription) return { ...base, status: "error", message: "Informe a descrição curta." };
    await saveProduct({
      reference,
      shortDescription: row.shortDescription,
      fullDescription: row.fullDescription ?? null,
      imageUrl: row.imageUrl ?? null,
      imageKey: row.imageKey ?? null,
      barcode: row.barcode ?? null,
      unit: row.unit ?? "UN",
      supplierName: row.supplierName ?? null,
      unitPrice: row.unitPrice ?? 0,
      costPrice: costPrice ?? null,
      reorderPoint: row.reorderPoint ?? 0,
      warrantyMonths: row.warrantyMonths ?? null,
      active: row.active ?? true,
      initialStock: access.canStock ? row.initialStock : undefined,
      responsible: access.responsible,
    });
    await ensureSupplier(row.supplierName);
    return { ...base, status: "created" };
  } catch (error) {
    // Regra de negócio tem mensagem para a pessoa; falha do banco pode trazer SQL.
    const failure = error as (Error & { code?: unknown; errno?: unknown }) | undefined;
    if (isDuplicateEntry(error)) return { ...base, status: "error", message: "Esta referência ou código de barras acabou de ser usado em outro produto." };
    if (failure?.constructor === Error && failure.code === undefined && failure.errno === undefined) return { ...base, status: "error", message: failure.message };
    console.error(`[Importação] linha ${row.line}:`, error);
    return { ...base, status: "error", message: "Não foi possível gravar esta linha. Tente de novo." };
  }
}
