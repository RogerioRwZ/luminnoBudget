import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getLocalAttachmentPath, saveLocalAttachment } from "./localStorage";

const originalDirectory = process.env.UPLOAD_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.env.UPLOAD_DIR = originalDirectory;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("armazenamento de anexos de orçamento", () => {
  it("persiste PDF permitido em subdiretório de anexos", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "luminno-attachments-"));
    temporaryDirectories.push(directory);
    process.env.UPLOAD_DIR = directory;
    const stored = await saveLocalAttachment("planta baixa.pdf", "application/pdf", Buffer.from("%PDF-1.7\nplanta"));
    expect(stored.key).toMatch(/^attachments\/planta-baixa-.+\.pdf$/);
    expect((await readFile(getLocalAttachmentPath(stored.key))).toString("ascii")).toContain("%PDF-1.7");
  });

  it("rejeita formato não permitido e travessia de diretório", async () => {
    await expect(saveLocalAttachment("arquivo.exe", "application/octet-stream", Buffer.from("x"))).rejects.toThrow("Formato de anexo não permitido");
    expect(() => getLocalAttachmentPath("../segredo.pdf")).toThrow("Chave de anexo inválida");
  });
});
