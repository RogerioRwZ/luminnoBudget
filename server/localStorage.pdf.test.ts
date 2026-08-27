import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getLocalPdfPath, saveLocalPdf } from "./localStorage";

const originalDirectory = process.env.PDF_HISTORY_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.env.PDF_HISTORY_DIR = originalDirectory;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("armazenamento privado de PDFs", () => {
  it("persiste um PDF válido fora do diretório público de uploads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "luminno-pdf-"));
    temporaryDirectories.push(directory);
    process.env.PDF_HISTORY_DIR = directory;

    const stored = await saveLocalPdf("orcamento-42", Buffer.from("%PDF-1.7\nconteudo"));
    const bytes = await readFile(getLocalPdfPath(stored.key));

    expect(stored.key).toMatch(/^orcamento-42-.+\.pdf$/);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("rejeita conteúdo que não seja um PDF", async () => {
    await expect(saveLocalPdf("arquivo", Buffer.from("texto comum"))).rejects.toThrow("não corresponde a um PDF válido");
  });
});
