import { afterEach, describe, expect, it } from "vitest";
import { inArray, or } from "drizzle-orm";
import { products } from "../drizzle/schema";
import { getDb } from "./db";
import { createProductVariants, getProduct, saveProduct } from "./quoteDb";

const roots: number[] = [];
afterEach(async () => {
  const db = await getDb();
  if (db && roots.length) await db.delete(products).where(or(inArray(products.id, roots), inArray(products.parentId, roots)));
  roots.length = 0;
});

describe("variações de produto", () => {
  it("cria variações em lote copiando o principal, pula repetidas e renomeia junto com o modelo", async () => {
    const model = `Spot teste ${Date.now()}`;
    const rootId = await saveProduct({ shortDescription: model, unit: "UN", supplierName: "Fornecedor", unitPrice: 59.9, reorderPoint: 2, active: true });
    roots.push(rootId);

    const first = await createProductVariants(rootId, [{ color: "Preto", colorTemperature: "3000" }, { color: "Branco", colorTemperature: "3000K" }]);
    expect(first.created).toHaveLength(2);
    const variant = (await getProduct(first.created[0]!))!;
    expect(variant).toMatchObject({ parentId: rootId, modelName: model, shortDescription: `${model} — Preto · 3000K`, unitPrice: "59.90", supplierName: "Fornecedor", stockQuantity: "0.00" });
    expect(variant.code).not.toBe((await getProduct(rootId))!.code);

    const again = await createProductVariants(first.created[1]!, [{ color: "branco", colorTemperature: "3000K" }, { color: "Dourado" }]);
    expect(again).toMatchObject({ rootId, skipped: ["branco · 3000K"] });
    expect(again.created).toHaveLength(1);

    await saveProduct({ id: rootId, shortDescription: model, modelName: `${model} novo`, attributes: { color: "Cinza" }, unit: "UN", unitPrice: 59.9, active: true });
    expect((await getProduct(rootId))!.shortDescription).toBe(`${model} novo — Cinza`);
    expect((await getProduct(first.created[1]!))!.shortDescription).toBe(`${model} novo — Branco · 3000K`);

    await expect(saveProduct({ id: first.created[1]!, shortDescription: "x", attributes: { color: "Preto", colorTemperature: "3000K" }, unit: "UN", unitPrice: 1, active: true })).rejects.toThrow(/já existe neste modelo/);
  }, 20_000);

  it("produto sem variação continua como antes e principal não vira variação de outro", async () => {
    const plain = await saveProduct({ shortDescription: `Fita ${Date.now()}`, unit: "M", unitPrice: 10, active: true });
    roots.push(plain);
    expect(await getProduct(plain)).toMatchObject({ parentId: null, modelName: null, attributes: null });
    const other = await saveProduct({ shortDescription: `Outro ${Date.now()}`, unit: "UN", unitPrice: 10, active: true });
    roots.push(other);
    await createProductVariants(other, [{ power: "10" }]);
    await expect(saveProduct({ id: other, shortDescription: "Outro", parentId: plain, unit: "UN", unitPrice: 10, active: true })).rejects.toThrow(/já é o principal/);
  });
});
