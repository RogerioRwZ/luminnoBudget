import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, products, stockMovements, suppliers } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const stamp = Date.now().toString(36).toUpperCase();
const ref = (name: string) => `IMP-${stamp}-${name}`;
const caller = (role: string, name = "Pessoa Logada") => appRouter.createCaller({ user: { id: 1, username: "imp", name, role, active: true }, req: {} as never, res: {} as never } as never);
const supplierNames = [`Forn ${stamp}`, `Outro ${stamp}`];

describe("importação do catálogo", () => {
  beforeAll(async () => { await getDb(); });
  afterAll(async () => {
    const db = (await getDb())!;
    const rows = await db.select({ id: products.id }).from(products).where(inArray(products.reference, ["A", "B", "C", "D", "E", "F"].map(ref)));
    if (rows.length) {
      await db.delete(stockMovements).where(inArray(stockMovements.productId, rows.map((row) => row.id)));
      await db.delete(products).where(inArray(products.id, rows.map((row) => row.id)));
    }
    await db.delete(suppliers).where(inArray(suppliers.name, supplierNames));
    await db.delete(activityLog).where(inArray(activityLog.action, ["product.import"]));
  });

  it("cria produto com todos os campos, fornecedor e entrada no nome de quem importou", async () => {
    const [result] = await caller("admin").product.importRows({ mode: "skip", rows: [{
      line: 2, reference: ref("A"), shortDescription: "Lustre", fullDescription: "Lustre completo", barcode: `9${Date.now()}`, unit: "PC", supplierName: supplierNames[0], unitPrice: 199.9, costPrice: 80, initialStock: 15.5, reorderPoint: 3, warrantyMonths: 24, active: true,
    }] });
    expect(result).toMatchObject({ line: 2, status: "created" });
    const db = (await getDb())!;
    const [saved] = await db.select().from(products).where(inArray(products.reference, [ref("A")]));
    expect(saved).toMatchObject({ fullDescription: "Lustre completo", unit: "PC", supplierName: supplierNames[0], unitPrice: "199.90", costPrice: "80.00", stockQuantity: "15.50", reorderPoint: "3.00", warrantyMonths: 24 });
    const moves = await db.select().from(stockMovements).where(inArray(stockMovements.productId, [saved!.id]));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: "entry", responsible: "Pessoa Logada" });
    expect((await caller("admin").suppliers.list()).map((supplier) => supplier.name)).toContain(supplierNames[0]);
  });

  it("ignora o existente por padrão e atualiza sem mexer no estoque nem no que veio vazio", async () => {
    const admin = caller("admin");
    const [skipped] = await admin.product.importRows({ mode: "skip", rows: [{ line: 3, reference: ref("A"), shortDescription: "Outro nome", initialStock: 99 }] });
    expect(skipped!.status).toBe("skipped");
    const db = (await getDb())!;
    const read = async () => (await db.select().from(products).where(inArray(products.reference, [ref("A")])))[0]!;
    expect((await read()).shortDescription).toBe("Lustre");
    const [updated] = await admin.product.importRows({ mode: "update", rows: [{ line: 3, reference: ref("A").toLowerCase(), unitPrice: 250, supplierName: supplierNames[1], initialStock: 99 }] });
    expect(updated).toMatchObject({ status: "updated", priceChange: { de: 199.9, para: 250 } });
    const saved = await read();
    expect(saved).toMatchObject({ shortDescription: "Lustre", fullDescription: "Lustre completo", unitPrice: "250.00", costPrice: "80.00", stockQuantity: "15.50", warrantyMonths: 24, supplierName: supplierNames[1] });
    expect((await db.select().from(stockMovements).where(inArray(stockMovements.productId, [saved.id])))).toHaveLength(1);
  });

  it("Vendas não grava custo nem lança estoque, e atualizar não apaga o custo", async () => {
    const sales = caller("sales");
    const [created] = await sales.product.importRows({ mode: "skip", rows: [{ line: 2, reference: ref("B"), shortDescription: "Item", unitPrice: 10, costPrice: 5, initialStock: 7 }] });
    expect(created!.status).toBe("created");
    const db = (await getDb())!;
    const [saved] = await db.select().from(products).where(inArray(products.reference, [ref("B")]));
    expect(saved).toMatchObject({ costPrice: null, stockQuantity: "0.00" });
    await sales.product.importRows({ mode: "update", rows: [{ line: 2, reference: ref("A"), costPrice: 1 }] });
    const [other] = await db.select().from(products).where(inArray(products.reference, [ref("A")]));
    expect(other!.costPrice).toBe("80.00");
  });

  it("a linha com erro não derruba as outras", async () => {
    const results = await caller("admin").product.importRows({ mode: "skip", rows: [
      { line: 2, reference: ref("C"), shortDescription: "Boa" },
      { line: 3, reference: ref("D") },
      { line: 4, reference: ref("E"), shortDescription: "Unidade ruim", unit: "12" },
      { line: 5, reference: ref("F"), shortDescription: "Boa também" },
    ] });
    expect(results.map((result) => result.status)).toEqual(["created", "error", "error", "created"]);
    expect(results[1]!.message).toContain("descrição curta");
    expect(results[2]!.message).toContain("unidade");
  });

  it("não deixa quem não tem catálogo importar", async () => {
    await expect(caller("finance").product.importRows({ mode: "skip", rows: [{ line: 2, reference: ref("X"), shortDescription: "x" }] })).rejects.toThrow();
  });

  it("registra a importação no log", async () => {
    const db = (await getDb())!;
    const rows = await db.select().from(activityLog).where(inArray(activityLog.action, ["product.import"]));
    expect(rows.some((row) => row.summary.includes("Importou produtos por planilha"))).toBe(true);
  });
});
