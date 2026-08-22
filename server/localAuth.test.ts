import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertUsername, hashPassword, signLocalSession, verifyLocalSession, verifyPassword } from "./localAuth";
import { saveLocalImage } from "./localStorage";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  delete process.env.UPLOAD_DIR;
});

describe("autenticação local", () => {
  it("gera hash com sal, valida a senha correta e rejeita senha incorreta", async () => {
    const hash = await hashPassword("senha-local-segura-2026");
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain("senha-local-segura-2026");
    await expect(verifyPassword("senha-local-segura-2026", hash)).resolves.toBe(true);
    await expect(verifyPassword("senha-errada-2026", hash)).resolves.toBe(false);
  });

  it("normaliza nomes de usuário e assina uma sessão de usuário ativo", async () => {
    process.env.JWT_SECRET = "a".repeat(64);
    expect(assertUsername("  Comercial.Luminno  ")).toBe("comercial.luminno");
    expect(() => assertUsername("x!")).toThrow("O usuário deve ter");
    const token = await signLocalSession({ id: 7, username: "comercial.luminno", role: "admin", isActive: true } as any);
    await expect(verifyLocalSession(token)).resolves.toEqual({ userId: 7, username: "comercial.luminno", role: "admin" });
  });
});

describe("armazenamento local de imagens", () => {
  it("grava uma imagem JPEG válida em diretório local e retorna URL pública interna", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "luminno-upload-"));
    tempDirectories.push(directory);
    process.env.UPLOAD_DIR = directory;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
    const file = await saveLocalImage("products", "Spot de teste.jpg", "image/jpeg", jpeg);
    expect(file.url).toMatch(/^\/uploads\/products\/Spot-de-teste-/);
    expect(await readFile(path.join(directory, file.key))).toEqual(jpeg);
  });

  it("rejeita arquivo cujo conteúdo não corresponde ao tipo informado", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "luminno-upload-"));
    tempDirectories.push(directory);
    process.env.UPLOAD_DIR = directory;
    await expect(saveLocalImage("store-brand", "logo.png", "image/png", Buffer.from("arquivo invalido"))).rejects.toThrow("não corresponde");
  });
});
