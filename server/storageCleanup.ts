import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { isNotNull, lt } from "drizzle-orm";
import { activityLog, products, quoteAttachments, quoteItems, quotePdfHistory, quoteVersions, storeSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { getPdfHistoryDirectory, getUploadDirectory } from "./localStorage";

// Arquivo recém-enviado ainda pode estar num cadastro aberto (ou num rascunho
// salvo no aparelho): só é apagado depois deste prazo sem ninguém usá-lo.
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
// Registro de atividades: mantém dois anos.
const ACTIVITY_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;

const UPLOAD_PATTERN = /\/uploads\/((?:products|store-brand)\/[^"'\s)\\?#]+)/g;

// Tudo o que ainda aponta para um arquivo: fotos de produto, itens de
// orçamento (guardam a foto do momento), versões, dados dos PDFs do
// histórico, logotipo e anexos.
async function referencedFiles() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const [productRows, itemRows, versionRows, pdfRows, settingsRows, attachmentRows] = await Promise.all([
    db.select({ imageUrl: products.imageUrl, imageKey: products.imageKey }).from(products),
    db.select({ imageUrl: quoteItems.imageUrl }).from(quoteItems).where(isNotNull(quoteItems.imageUrl)),
    db.select({ snapshot: quoteVersions.snapshot }).from(quoteVersions),
    db.select({ snapshot: quotePdfHistory.snapshot, storageKey: quotePdfHistory.storageKey }).from(quotePdfHistory),
    db.select({ logoUrl: storeSettings.logoUrl }).from(storeSettings),
    db.select({ storageKey: quoteAttachments.storageKey }).from(quoteAttachments),
  ]);
  const uploads = new Set<string>();
  const collect = (text: string | null | undefined) => {
    for (const match of Array.from((text ?? "").matchAll(UPLOAD_PATTERN))) {
      try {
        uploads.add(path.normalize(decodeURIComponent(match[1]!)));
      } catch {
        uploads.add(path.normalize(match[1]!));
      }
    }
  };
  productRows.forEach((row) => {
    collect(row.imageUrl);
    if (row.imageKey) uploads.add(path.normalize(row.imageKey));
  });
  itemRows.forEach((row) => collect(row.imageUrl));
  versionRows.forEach((row) => collect(row.snapshot));
  pdfRows.forEach((row) => collect(row.snapshot));
  settingsRows.forEach((row) => collect(row.logoUrl));
  attachmentRows.forEach((row) => uploads.add(path.normalize(row.storageKey)));
  const pdfs = new Set(pdfRows.map((row) => row.storageKey).filter((key): key is string => Boolean(key)));
  return { uploads, pdfs };
}

async function listFiles(root: string, folder: string) {
  try {
    const entries = await readdir(path.join(root, folder), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(folder, entry.name));
  } catch {
    return [];
  }
}

async function removeIfStale(root: string, relative: string, now: number) {
  const file = path.join(root, relative);
  const info = await stat(file).catch(() => null);
  if (!info || now - info.mtimeMs < GRACE_MS) return 0;
  await unlink(file).catch(() => undefined);
  // Conta arquivo vazio também (sobra de envio interrompido).
  return Math.max(info.size, 1);
}

// Apaga fotos trocadas ou removidas, anexos de orçamentos excluídos, PDFs
// antigos sem registro e sobras de envios interrompidos. Nunca apaga nada se
// não conseguir ler o banco.
export async function cleanupOrphanFiles(now = Date.now()) {
  const { uploads, pdfs } = await referencedFiles();
  const uploadRoot = getUploadDirectory();
  const pdfRoot = getPdfHistoryDirectory();
  const result = { files: 0, bytes: 0 };
  for (const folder of ["products", "store-brand", "attachments"]) {
    for (const relative of await listFiles(uploadRoot, folder)) {
      if (uploads.has(path.normalize(relative))) continue;
      const freed = await removeIfStale(uploadRoot, relative, now);
      if (freed) {
        result.files += 1;
        result.bytes += freed;
      }
    }
  }
  for (const relative of await listFiles(pdfRoot, ".")) {
    if (pdfs.has(path.basename(relative))) continue;
    const freed = await removeIfStale(pdfRoot, relative, now);
    if (freed) {
      result.files += 1;
      result.bytes += freed;
    }
  }
  return result;
}

export async function pruneActivityLog(now = new Date()) {
  const db = await getDb();
  if (!db) return 0;
  const [header] = await db.delete(activityLog).where(lt(activityLog.createdAt, new Date(now.getTime() - ACTIVITY_RETENTION_MS)));
  return (header as { affectedRows?: number }).affectedRows ?? 0;
}

// Uma vez por dia (e 5 minutos depois de ligar). Falhas só vão para o log.
export function startStorageCleanup() {
  const run = async () => {
    try {
      const files = await cleanupOrphanFiles();
      const logs = await pruneActivityLog();
      if (files.files || logs) console.log(`[limpeza] ${files.files} arquivo(s) sem uso apagado(s) (${(files.bytes / 1024 / 1024).toFixed(1)} MB), ${logs} registro(s) de atividade com mais de 2 anos.`);
    } catch (error) {
      console.warn("[limpeza] não executada:", error instanceof Error ? error.message : error);
    }
  };
  setTimeout(run, 5 * 60_000).unref();
  const timer = setInterval(run, 24 * 60 * 60_000);
  timer.unref();
  return timer;
}
