import { afterEach, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { products } from "../drizzle/schema";
import { getDb } from "./db";
import { importBackup, saveProduct } from "./quoteDb";
import { inventoryOverview, purchaseSuggestions } from "./stockDb";

const ids: number[] = [];
afterEach(async () => {
  const db = (await getDb())!;
  if (ids.length) await db.delete(products).where(inArray(products.id, ids.splice(0)));
});
const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();

describe("sem variações", () => {
  it("restaurar backup antigo: variações viram produtos e o modelo sem estoque é arquivado", async () => {
    const t = tag();
    const base = { unit: "UN", unitPrice: "10.00", code: `C${t}`, active: true, stockQuantity: "0.00", reorderPoint: "5.00" };
    const n = Math.floor(Math.random() * 1_000_000) + 2_000_000;
    ids.push(n, n + 1, n + 2);
    await importBackup({
      replace: false,
      data: {
        products: [
          { ...base, id: n, code: `A${t}`, reference: `MOD-${t}`, shortDescription: "Modelo", parentId: null, attributes: null, modelName: "Modelo" },
          { ...base, id: n + 1, code: `B${t}`, reference: `VAR-${t}`, shortDescription: "Modelo — Preto", parentId: n, attributes: '{"color":"Preto"}', modelName: "Modelo", stockQuantity: "3.00" },
          { ...base, id: n + 2, code: `D${t}`, reference: null, shortDescription: "Avulso", parentId: null, attributes: null, modelName: null },
        ],
      },
    });
    const db = (await getDb())!;
    const rows = await db.select().from(products).where(inArray(products.id, [n, n + 1, n + 2]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(n)).toMatchObject({ active: false, reorderPoint: "0.00" });
    expect(byId.get(n + 1)).toMatchObject({ active: true, stockQuantity: "3.00", reference: `VAR-${t}`, shortDescription: "Modelo — Preto" });
    expect(byId.get(n + 2)).toMatchObject({ active: true, reference: `D${t}` });
  });

  it("produto arquivado e sem saldo sai do estoque, da reposição e de compras", async () => {
    const id = await saveProduct({ reference: `ARQ-${tag()}`, shortDescription: `Arquivado ${tag()}`, unit: "UN", unitPrice: 1, reorderPoint: 5, active: false });
    ids.push(id);
    const overview = await inventoryOverview();
    expect(overview.products.some((row) => row.id === id)).toBe(false);
    expect(overview.lowStock.some((row) => row.id === id)).toBe(false);
    expect((await purchaseSuggestions()).flatMap((group) => group.lines).some((line) => line.productId === id)).toBe(false);
  });

  it("migração: modelo sem estoque é arquivado; com estoque ou com cor continua ativo", async () => {
    const db = (await getDb())!;
    const [update] = readFileSync("drizzle/0022_retirar_variacoes.sql", "utf8").split("--> statement-breakpoint");
    await db.execute(sql`DROP TABLE IF EXISTS tmp_products_migration`);
    await db.execute(sql`CREATE TABLE tmp_products_migration (id int primary key, parentId int, attributes text, active boolean, reorderPoint decimal(12,2), stockQuantity decimal(12,2))`);
    try {
      await db.execute(sql`INSERT INTO tmp_products_migration VALUES (1, NULL, NULL, 1, 5, 0), (2, 1, '{"color":"Preto"}', 1, 0, 0), (3, NULL, NULL, 1, 5, 2), (4, 3, NULL, 1, 0, 0), (5, NULL, '{"color":"Preto"}', 1, 0, 0), (6, 5, '{"color":"Branco"}', 1, 0, 0), (7, NULL, NULL, 1, 0, 0)`);
      await db.execute(sql.raw(update!.replaceAll("`products`", "`tmp_products_migration`")));
      const [rows] = (await db.execute(sql`SELECT id, active, reorderPoint FROM tmp_products_migration ORDER BY id`)) as unknown as [Array<{ id: number; active: number; reorderPoint: string }>];
      expect(rows.map((row) => row.active)).toEqual([0, 1, 1, 1, 1, 1, 1]);
      expect(rows[0]!.reorderPoint).toBe("0.00");
      expect(rows[2]!.reorderPoint).toBe("5.00");
    } finally {
      await db.execute(sql`DROP TABLE IF EXISTS tmp_products_migration`);
    }
  });
});
