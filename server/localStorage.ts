import type { Express } from "express";
import express from "express";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const supportedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const supportedAttachmentTypes = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export function getUploadDirectory() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
}

export function getPdfHistoryDirectory() {
  return path.resolve(process.env.PDF_HISTORY_DIR || path.join(path.dirname(getUploadDirectory()), "pdf-history"));
}

export async function ensureUploadDirectory() {
  await mkdir(getUploadDirectory(), { recursive: true, mode: 0o750 });
}

export async function ensurePdfHistoryDirectory() {
  await mkdir(getPdfHistoryDirectory(), { recursive: true, mode: 0o750 });
}

function assertImageSignature(bytes: Buffer, mimeType: string) {
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const valid = (mimeType === "image/jpeg" && isJpeg) || (mimeType === "image/png" && isPng) || (mimeType === "image/webp" && isWebp);
  if (!valid) throw new Error("O conteúdo do arquivo não corresponde a uma imagem JPEG, PNG ou WebP válida.");
}

function safeStem(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "imagem";
}

export async function saveLocalImage(scope: "products" | "store-brand", fileName: string, mimeType: string, bytes: Buffer) {
  const extension = supportedTypes.get(mimeType);
  if (!extension) throw new Error("Formato de imagem não permitido.");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("A imagem deve ter até 5 MB.");
  assertImageSignature(bytes, mimeType);
  await ensureUploadDirectory();

  const key = `${scope}/${safeStem(fileName)}-${randomUUID()}.${extension}`;
  const destination = path.join(getUploadDirectory(), key);
  const root = getUploadDirectory();
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Caminho de upload inválido.");
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await writeFile(temporary, bytes, { mode: 0o640 });
  await rename(temporary, destination);
  return { key, url: `/uploads/${key}` };
}

export async function saveLocalAttachment(fileName: string, mimeType: string, bytes: Buffer) {
  const extension = supportedAttachmentTypes.get(mimeType);
  if (!extension) throw new Error("Formato de anexo não permitido. Use PDF, JPG, PNG ou WebP.");
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("O anexo deve ter até 15 MB.");
  await ensureUploadDirectory();
  const key = `attachments/${safeStem(fileName)}-${randomUUID()}.${extension}`;
  const destination = path.join(getUploadDirectory(), key);
  const root = getUploadDirectory();
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Caminho de anexo inválido.");
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await writeFile(temporary, bytes, { mode: 0o640 });
  await rename(temporary, destination);
  return { key, fileSize: bytes.length };
}

export async function saveLocalPdf(fileName: string, bytes: Buffer) {
  if (bytes.length < 5 || bytes.length > MAX_PDF_BYTES) throw new Error("O PDF deve ter até 8 MB.");
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("O conteúdo enviado não corresponde a um PDF válido.");
  await ensurePdfHistoryDirectory();

  const key = `${safeStem(fileName)}-${randomUUID()}.pdf`;
  const destination = path.join(getPdfHistoryDirectory(), key);
  const root = getPdfHistoryDirectory();
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Caminho de PDF inválido.");
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await writeFile(temporary, bytes, { mode: 0o640 });
  await rename(temporary, destination);
  return { key, fileSize: bytes.length };
}

export function getLocalAttachmentPath(storageKey: string) {
  const root = getUploadDirectory();
  const normalized = path.normalize(storageKey);
  if (!normalized.startsWith(`attachments${path.sep}`) || normalized.includes(`..${path.sep}`)) throw new Error("Chave de anexo inválida.");
  const destination = path.join(root, normalized);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Caminho de anexo inválido.");
  return destination;
}

export function getLocalPdfPath(storageKey: string) {
  const root = getPdfHistoryDirectory();
  const key = path.basename(storageKey);
  if (key !== storageKey || !key.endsWith(".pdf")) throw new Error("Chave de PDF inválida.");
  return path.join(root, key);
}

export function registerLocalStorage(app: Express) {
  const root = getUploadDirectory();
  app.use("/uploads", express.static(root, { fallthrough: false, index: false, maxAge: "7d", immutable: true }));
}
