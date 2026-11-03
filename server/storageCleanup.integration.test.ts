import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { activityLog, products, quotePdfHistory, quotes } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { cleanupOrphanFiles, pruneActivityLog } from "./storageCleanup";

const caller = () => appRouter.createCaller({ user: { id: 999_008, role: "admin", name: "Teste", username: "teste" } as any, req: { headers: {}, ip: "127.0.0.1" } as any, res: {} as any });
const env = { UPLOAD_DIR: process.env.UPLOAD_DIR, PDF_HISTORY_DIR: process.env.PDF_HISTORY_DIR };
const created = { dirs: [] as string[], products: [] as number[], quotes: [] as number[], logs: [] as number[] };

afterEach(async () => {
  Object.assign(process.env, env);
  const db = (await getDb())!;
  if (created.products.length) await db.delete(products).where(inArray(products.id, created.products));
  if (created.quotes.length) {
    await db.delete(quotePdfHistory).where(inArray(quotePdfHistory.quoteId, created.quotes));
    await db.delete(quotes).where(inArray(quotes.id, created.quotes));
  }
  if (created.logs.length) await db.delete(activityLog).where(inArray(activityLog.id, created.logs));
  await Promise.all(created.dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  Object.assign(created, { dirs: [], products: [], quotes: [], logs: [] });
});

async function file(root: string, relative: string, daysOld: number) {
  const full = path.join(root, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "x".repeat(100));
  const when = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  await utimes(full, when, when);
}

describe("economia de armazenamento", () => {
  it("o histórico guarda os dados do PDF, sem arquivo, e devolve para montar de novo", async () => {
    const admin = caller();
    const quote = (await admin.quote.create())!;
    created.quotes.push(quote.id);
    const snapshot = JSON.stringify({ quoteNumber: quote.quoteNumber, clientName: "Ana", rooms: [{ name: "SALA", items: [] }], summary: { total: 10 } });
    const entry = await admin.quote.savePdf({ quoteId: quote.id, snapshot, fileSize: 85_000, clientName: "Ana" });
    expect(entry).toMatchObject({ rebuild: true, downloadUrl: null, fileSize: 85_000 });
    expect(await admin.quote.pdfSnapshot({ id: entry.id })).toMatchObject({ snapshot, fileName: expect.stringMatching(/Ana\.pdf$/) });
    await expect(admin.quote.savePdf({ quoteId: quote.id, snapshot: "{}", fileSize: 1 })).rejects.toThrow(/inválidos/);
  });

  it("apaga só arquivos sem uso e com mais de 3 dias", async () => {
    const uploads = await mkdtemp(path.join(os.tmpdir(), "luminno-up-"));
    const pdfs = await mkdtemp(path.join(os.tmpdir(), "luminno-pdf-"));
    created.dirs.push(uploads, pdfs);
    process.env.UPLOAD_DIR = uploads;
    process.env.PDF_HISTORY_DIR = pdfs;
    const stamp = Date.now().toString(36);

    // Foto em uso por um produto: fica.
    await file(uploads, `products/em-uso-${stamp}.webp`, 10);
    created.products.push(await caller().product.save({ reference: `LIMP-${stamp}`, shortDescription: "Limpeza", unit: "UN", unitPrice: 1, reorderPoint: 0, active: true, imageUrl: `/uploads/products/em-uso-${stamp}.webp`, imageKey: `products/em-uso-${stamp}.webp` }));
    // Foto citada só nos dados de um PDF do histórico: fica.
    await file(uploads, `products/no-pdf-${stamp}.jpg`, 10);
    const quote = (await caller().quote.create())!;
    created.quotes.push(quote.id);
    await caller().quote.savePdf({ quoteId: quote.id, snapshot: JSON.stringify({ rooms: [{ name: "A", items: [{ imageUrl: `/uploads/products/no-pdf-${stamp}.jpg` }] }], summary: {} }), fileSize: 1 });
    // Trocada há 10 dias: sai. Enviada ontem (cadastro talvez aberto): fica.
    await file(uploads, `products/trocada-${stamp}.jpg`, 10);
    await file(uploads, `products/recente-${stamp}.jpg`, 1);
    await file(uploads, `attachments/sem-registro-${stamp}.pdf`, 10);
    // PDF antigo sem registro no histórico: sai.
    await file(pdfs, `perdido-${stamp}.pdf`, 10);

    const result = await cleanupOrphanFiles();
    expect(result.files).toBe(3);
    expect((await readdir(path.join(uploads, "products"))).sort()).toEqual([`em-uso-${stamp}.webp`, `no-pdf-${stamp}.jpg`, `recente-${stamp}.jpg`].sort());
    expect(await readdir(path.join(uploads, "attachments"))).toEqual([]);
    expect(await readdir(pdfs)).toEqual([]);
  });

  it("apaga o registro de atividades com mais de 2 anos", async () => {
    const db = (await getDb())!;
    const now = new Date();
    const old = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);
    const [oldRow] = await db.insert(activityLog).values({ action: "teste", entityType: "teste", summary: "antigo", createdAt: old }).$returningId();
    const [newRow] = await db.insert(activityLog).values({ action: "teste", entityType: "teste", summary: "recente" }).$returningId();
    created.logs.push(oldRow!.id, newRow!.id);
    expect(await pruneActivityLog(now)).toBeGreaterThanOrEqual(1);
    const left = await db.select({ id: activityLog.id }).from(activityLog).where(inArray(activityLog.id, [oldRow!.id, newRow!.id]));
    expect(left.map((row) => row.id)).toEqual([newRow!.id]);
  });
});
