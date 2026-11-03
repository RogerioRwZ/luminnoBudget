import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { products } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const caller = () => appRouter.createCaller({ user: { id: 999_007, role: "admin", name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });
const created: number[] = [];
afterEach(async () => {
  const db = await getDb();
  if (db && created.length) await db.delete(products).where(inArray(products.id, created.splice(0)));
});

const base = { unit: "UN", unitPrice: 10, reorderPoint: 0, active: true };

describe("referência do produto", () => {
  it("é obrigatória, única (sem diferenciar maiúsculas) e entra na busca junto com o código de barras", async () => {
    const admin = caller();
    const stamp = Date.now().toString(36);
    await expect(admin.product.save({ ...base, reference: "  ", shortDescription: "Sem referência" })).rejects.toThrow(/referência/);

    const reference = `LM-${stamp}/PT #2`;
    const barcode = `78${String(Date.now()).slice(-11)}`;
    const id = await admin.product.save({ ...base, reference: `  ${reference} `, barcode: ` ${barcode} `, shortDescription: `Pendente referência ${stamp}` });
    created.push(id);
    const list = await admin.product.list({ search: reference.toLowerCase() });
    expect(list.map((product) => product.id)).toEqual([id]);
    expect(list[0]).toMatchObject({ reference, barcode });
    expect((await admin.product.list({ search: barcode })).map((product) => product.id)).toEqual([id]);
    expect((await admin.product.list({ search: `pendente ${stamp}` })).map((product) => product.id)).toEqual([id]);

    // O leitor acha pelo código de barras e também pela referência.
    expect((await admin.product.findByBarcode({ barcode }))?.id).toBe(id);
    expect((await admin.product.findByBarcode({ barcode: reference }))?.id).toBe(id);

    await expect(admin.product.save({ ...base, reference: reference.toUpperCase(), shortDescription: "Outro" })).rejects.toThrow(/já está no produto/);
    // Editar sem mudar a referência continua valendo.
    await admin.product.save({ ...base, id, reference, barcode: "", shortDescription: `Pendente referência ${stamp}` });
    expect((await admin.product.list({ search: reference }))[0]).toMatchObject({ reference, barcode: null });
  });
});
