import { and, desc, eq, max } from "drizzle-orm";
import { internalComments, messageTemplates, quoteAttachments, quoteVersions, products } from "../drizzle/schema";
import { getDb } from "./db";
import { getQuote, saveQuote, type QuoteDraft } from "./quoteDb";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  return db;
}

export async function listQuoteVersions(quoteId: number) {
  const db = await database();
  return db.select().from(quoteVersions).where(eq(quoteVersions.quoteId, quoteId)).orderBy(desc(quoteVersions.versionNumber));
}
export async function createQuoteVersion(input: { quoteId: number; snapshot: unknown; changeNote?: string | null; userId: number }) {
  const db = await database();
  const current = await db.select({ value: max(quoteVersions.versionNumber) }).from(quoteVersions).where(eq(quoteVersions.quoteId, input.quoteId));
  const versionNumber = Number(current[0]?.value ?? 0) + 1;
  const result = await db.insert(quoteVersions).values({ quoteId: input.quoteId, versionNumber, snapshot: JSON.stringify(input.snapshot), changeNote: input.changeNote || null, createdByUserId: input.userId });
  return { id: Number(result[0].insertId), versionNumber };
}

export async function restoreQuoteVersion(input: { versionId: number; userId: number; comment: string }) {
  const db = await database();
  const rows = await db.select().from(quoteVersions).where(eq(quoteVersions.id, input.versionId)).limit(1);
  const version = rows[0];
  if (!version) throw new Error("Versão não encontrada.");
  let snapshot: QuoteDraft;
  try { snapshot = JSON.parse(version.snapshot) as QuoteDraft; }
  catch { throw new Error("Snapshot inválido."); }
  if (!snapshot.id || snapshot.id !== version.quoteId || !Array.isArray(snapshot.rooms)) throw new Error("Snapshot incompatível com o orçamento.");
  const justification = input.comment.trim();
  if (justification.length < 10) throw new Error("Informe uma justificativa com pelo menos 10 caracteres.");
  const restored = await saveQuote({ ...snapshot, id: version.quoteId, status: snapshot.status === "lost" ? "open" : snapshot.status, notes: `${snapshot.notes ?? ""}${snapshot.notes ? "\n" : ""}Restaurado da versão ${version.versionNumber}.` }, input.userId);
  const restoredQuoteId = restored?.id ?? version.quoteId;
  const restoredSnapshot = await getQuote(restoredQuoteId);
  const createdVersion = restoredSnapshot ? await createQuoteVersion({ quoteId: restoredQuoteId, snapshot: restoredSnapshot, changeNote: `Restauração da versão ${version.versionNumber}: ${justification}`, userId: input.userId }) : null;
  await db.insert(internalComments).values({ quoteId: restoredQuoteId, body: `Restauração da versão ${version.versionNumber}: ${justification}`, authorUserId: input.userId });
  return { quoteId: restoredQuoteId, sourceVersion: version.versionNumber, restoredVersion: createdVersion?.versionNumber ?? null };
}

export async function listComments(quoteId: number) { const db = await database(); return db.select().from(internalComments).where(eq(internalComments.quoteId, quoteId)).orderBy(desc(internalComments.createdAt)); }
export async function addComment(input: { quoteId: number; body: string; userId: number }) { const db = await database(); const result = await db.insert(internalComments).values({ quoteId: input.quoteId, body: input.body.trim(), authorUserId: input.userId }); return { id: Number(result[0].insertId) }; }
export async function resolveComment(id: number, resolved: boolean) { const db = await database(); await db.update(internalComments).set({ resolved }).where(eq(internalComments.id, id)); return { id, resolved }; }

export async function listAttachments(quoteId: number) { const db = await database(); return db.select().from(quoteAttachments).where(eq(quoteAttachments.quoteId, quoteId)).orderBy(desc(quoteAttachments.createdAt)); }
export async function addAttachment(input: { quoteId: number; fileName: string; storageKey: string; mimeType: string; fileSize: number; userId: number }) { const db = await database(); const result = await db.insert(quoteAttachments).values({ quoteId: input.quoteId, fileName: input.fileName, storageKey: input.storageKey, mimeType: input.mimeType, fileSize: input.fileSize, createdByUserId: input.userId }); return { id: Number(result[0].insertId) }; }
export async function getAttachment(id: number) { const db = await database(); const rows = await db.select().from(quoteAttachments).where(eq(quoteAttachments.id, id)).limit(1); return rows[0] ?? null; }

export async function listMessageTemplates() { const db = await database(); return db.select().from(messageTemplates).orderBy(messageTemplates.event); }
export async function saveMessageTemplate(input: { id?: number; event: "quote_sent"|"quote_approved"|"quote_expiring"|"quote_expired"|"payment_due"|"payment_overdue"|"delivery_scheduled"|"delivery_completed"; name: string; subject?: string | null; body: string; active: boolean }) { const db = await database(); if (input.id) { await db.update(messageTemplates).set({ event: input.event, name: input.name, subject: input.subject || null, body: input.body, active: input.active }).where(eq(messageTemplates.id, input.id)); return { id: input.id }; } const result = await db.insert(messageTemplates).values({ event: input.event, name: input.name, subject: input.subject || null, body: input.body, active: input.active }); return { id: Number(result[0].insertId) }; }
export async function findProductByBarcode(barcode: string) { const db = await database(); const rows = await db.select().from(products).where(eq(products.barcode, barcode.trim())).limit(1); return rows[0] ?? null; }
export async function updateProductBarcode(productId: number, barcode: string | null) { const db = await database(); await db.update(products).set({ barcode: barcode || null }).where(eq(products.id, productId)); return { productId, barcode }; }
