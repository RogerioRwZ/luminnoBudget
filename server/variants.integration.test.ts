import { afterEach, describe, expect, it } from "vitest";
import { inArray, or } from "drizzle-orm";
import { products } from "../drizzle/schema";
import { getDb } from "./db";
import { createProductVariants, getProduct, saveProduct, saveProductFamily, saveProductWithVariants } from "./quoteDb";
import { findProductByBarcode } from "./advancedDb";
import { inventoryOverview, purchaseSuggestions } from "./stockDb";

const roots: number[] = [];
afterEach(async () => {
  const db = await getDb();
  if (db && roots.length) await db.delete(products).where(or(inArray(products.id, roots), inArray(products.parentId, roots)));
  roots.length = 0;
});

const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();

describe("variações de produto", () => {
  it("cada variação tem a sua referência; detalhes e código de barras são opcionais", async () => {
    const model = `Spot teste ${Date.now()}`;
    const t = tag();
    const rootId = await saveProduct({ reference: `T-${t}`, shortDescription: model, unit: "UN", supplierName: "Fornecedor", unitPrice: 59.9, reorderPoint: 2, active: true });
    roots.push(rootId);

    // Sem referência, nada é criado.
    await expect(createProductVariants(rootId, [{ attributes: { color: "Preto" }, reference: `A-${t}` }, { attributes: { color: "Branco" }, reference: " " }])).rejects.toThrow(/informe a referência/);
    expect((await getProduct(rootId))!.modelName).toBeNull();

    const first = await createProductVariants(rootId, [
      { attributes: { color: "Preto", colorTemperature: "3000" }, reference: `PT-${t}` },
      { attributes: { color: "Branco", colorTemperature: "3000K" }, reference: `BR-${t}`, barcode: ` 789 ${String(Date.now()).slice(-10)} ` },
      // Sem nenhum detalhe: a referência diferencia no nome.
      { attributes: {}, reference: `LISO-${t}` },
    ]);
    expect(first.created).toHaveLength(3);
    expect(await getProduct(first.created[0]!)).toMatchObject({ parentId: rootId, modelName: model, reference: `PT-${t}`, barcode: null, shortDescription: `${model} — Preto · 3000K`, unitPrice: "59.90", supplierName: "Fornecedor", stockQuantity: "0.00" });
    expect((await getProduct(first.created[1]!))!.barcode).toMatch(/^789\d{10}$/);
    expect(await getProduct(first.created[2]!)).toMatchObject({ attributes: null, shortDescription: `${model} — Ref. LISO-${t}` });

    // Mesmos detalhes de uma variação existente: bloqueado, sem criar nada.
    await expect(createProductVariants(first.created[1]!, [{ attributes: { color: "Dourado" }, reference: `DR-${t}` }, { attributes: { color: "branco", colorTemperature: "3000K" }, reference: `BR2-${t}` }])).rejects.toThrow(/já existe neste modelo/);
    // Outra variação sem detalhes é aceita (a referência é diferente).
    expect((await createProductVariants(rootId, [{ reference: `LISO2-${t}` }])).created).toHaveLength(1);

    await saveProduct({ id: rootId, shortDescription: model, modelName: `${model} novo`, unit: "UN", unitPrice: 59.9, active: true });
    expect((await getProduct(first.created[1]!))!.shortDescription).toBe(`${model} novo — Branco · 3000K`);
    expect((await getProduct(first.created[2]!))!.shortDescription).toBe(`${model} novo — Ref. LISO-${t}`);
    await expect(saveProduct({ id: first.created[1]!, shortDescription: "x", attributes: { color: "Preto", colorTemperature: "3000K" }, unit: "UN", unitPrice: 1, active: true })).rejects.toThrow(/já existe neste modelo/);
  }, 20_000);

  it("cadastro com variações: modelo sem referência ganha uma interna e cada variação a sua", async () => {
    const t = tag();
    const result = await saveProductWithVariants({ shortDescription: `Arandela ${t}`, unit: "UN", unitPrice: 80, active: true }, [
      { attributes: { color: "Preto" }, reference: `AR-PT-${t}` },
      { reference: `AR-${t}` },
    ]);
    roots.push(result.rootId);
    const root = (await getProduct(result.rootId))!;
    expect(root.reference).toBe(`MOD-${root.code}`);
    expect(root.barcode).toBeNull();
    expect((await getProduct(result.created[1]!))!.shortDescription).toBe(`Arandela ${t} — Ref. AR-${t}`);
  });

  it("editar o modelo atualiza referência e código de barras de cada variação e cria as novas", async () => {
    const t = tag();
    const { rootId, created } = await saveProductWithVariants({ shortDescription: `Plafon ${t}`, unit: "UN", unitPrice: 120, active: true }, [
      { attributes: { color: "Preto" }, reference: `PL-PT-${t}` },
      { attributes: { color: "Branco" }, reference: `PL-BR-${t}` },
    ]);
    roots.push(rootId);
    const root = (await getProduct(rootId))!;
    const model = { id: rootId, reference: root.reference!, shortDescription: `Plafon ${t}`, modelName: `Plafon ${t}`, unit: "UN", unitPrice: 130, active: true };
    // Trocar para uma referência já usada por outra variação: nada muda.
    await expect(saveProductFamily(model, [{ id: created[0]!, attributes: { color: "Preto" }, reference: `PL-BR-${t}` }, { id: created[1]!, attributes: { color: "Branco" }, reference: `PL-BR-${t}` }])).rejects.toThrow(/já está em uso/);
    const barcode = `78${String(Date.now()).slice(-11)}`;
    const result = await saveProductFamily(model, [
      { id: created[0]!, attributes: { color: "Preto", power: "18" }, reference: `PL/PT18-${t}`, barcode },
      { id: created[1]!, attributes: { color: "Branco" }, reference: `PL-BR-${t}` },
      { attributes: { color: "Cobre" }, reference: `PL-CB-${t}` },
    ]);
    expect(result).toMatchObject({ updated: [created[0], created[1]], created: [expect.any(Number)] });
    expect(await getProduct(created[0]!)).toMatchObject({ reference: `PL/PT18-${t}`, barcode, shortDescription: `Plafon ${t} — Preto · 18W` });
    expect(await getProduct(result.created[0]!)).toMatchObject({ reference: `PL-CB-${t}`, parentId: rootId, unitPrice: "130.00" });
    expect((await getProduct(rootId))!.unitPrice).toBe("130.00");
  });

  it("o modelo não entra em estoque, compras nem leitura; aplicar às variações e reposição por variação", async () => {
    const t = tag();
    // Modelo antigo com ponto de reposição: antes aparecia em Compras.
    const rootId = await saveProduct({ reference: `MODX-${t}`, shortDescription: `Trilho ${t}`, unit: "UN", unitPrice: 50, reorderPoint: 5, active: true, supplierName: "Antigo" });
    roots.push(rootId);
    const { created } = await createProductVariants(rootId, [{ attributes: { color: "Preto" }, reference: `TR-PT-${t}`, reorderPoint: 2 }, { attributes: { color: "Branco" }, reference: `TR-BR-${t}` }]);
    expect((await getProduct(created[0]!))!.reorderPoint).toBe("2.00");
    expect((await getProduct(created[1]!))!.reorderPoint).toBe("0.00");

    const lines = (await purchaseSuggestions()).flatMap((group) => group.lines.map((line) => line.productId));
    expect(lines).not.toContain(rootId);
    expect(lines).toContain(created[0]);
    const overview = await inventoryOverview();
    expect(overview.products.some((product) => product.id === rootId)).toBe(false);
    expect(overview.lowStock.some((product) => product.id === rootId)).toBe(false);
    expect(await findProductByBarcode(`MODX-${t}`)).toBeNull();
    expect((await findProductByBarcode(`TR-PT-${t}`))?.id).toBe(created[0]);

    const model = { id: rootId, reference: `MODX-${t}`, shortDescription: `Trilho ${t}`, modelName: `Trilho ${t}`, unit: "UN", unitPrice: 75, costPrice: 30, supplierName: "Novo", imageUrl: "/uploads/products/trilho.webp", imageKey: "products/trilho.webp", active: true, reorderPoint: 0 };
    const variants = [{ id: created[0]!, attributes: { color: "Preto" }, reference: `TR-PT-${t}` }, { id: created[1]!, attributes: { color: "Branco" }, reference: `TR-BR-${t}`, reorderPoint: 4 }];
    // Desligado: as variações mantêm preço e fornecedor (e a reposição não enviada).
    await saveProductFamily(model, variants);
    expect(await getProduct(created[0]!)).toMatchObject({ unitPrice: "50.00", supplierName: "Antigo", reorderPoint: "2.00" });
    expect((await getProduct(created[1]!))!.reorderPoint).toBe("4.00");
    // Ligado: preço, custo, fornecedor e foto do modelo vão para as variações.
    await saveProductFamily(model, variants, { applyToVariants: true });
    expect(await getProduct(created[0]!)).toMatchObject({ unitPrice: "75.00", costPrice: "30.00", supplierName: "Novo", imageUrl: "/uploads/products/trilho.webp", reference: `TR-PT-${t}` });
  });

  it("produto sem variação continua como antes e principal não vira variação de outro", async () => {
    const plain = await saveProduct({ reference: `T-${tag()}`, shortDescription: `Fita ${Date.now()}`, unit: "M", unitPrice: 10, active: true });
    roots.push(plain);
    expect(await getProduct(plain)).toMatchObject({ parentId: null, modelName: null, attributes: null });
    const other = await saveProduct({ reference: `T-${tag()}`, shortDescription: `Outro ${Date.now()}`, unit: "UN", unitPrice: 10, active: true });
    roots.push(other);
    await createProductVariants(other, [{ attributes: { power: "10" }, reference: `T-${tag()}` }]);
    await expect(saveProduct({ id: other, shortDescription: "Outro", parentId: plain, unit: "UN", unitPrice: 10, active: true })).rejects.toThrow(/já é o principal/);
  });
});
