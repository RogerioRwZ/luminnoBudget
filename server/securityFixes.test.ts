import express from "express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, resolveSessionUser, signLocalSession, verifyPasswordOrDummy } from "./localAuth";
import { saveLocalAttachment, registerLocalStorage } from "./localStorage";
import { assertLoginAllowed, loginRateLimitConfig, registerLoginFailure, resetLoginRateLimitForTests } from "./loginRateLimit";
import { isDuplicateQuoteNumberError, reviveBackupDates } from "./quoteDb";

const originalUploadDir = process.env.UPLOAD_DIR;
const temporaryDirectories: string[] = [];

beforeEach(() => {
  process.env.JWT_SECRET = "s".repeat(64);
  resetLoginRateLimitForTests();
});

afterEach(async () => {
  process.env.UPLOAD_DIR = originalUploadDir;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("sessões vinculadas à senha", () => {
  it("invalida sessões emitidas antes de uma troca de senha", async () => {
    const original = { id: 3, username: "ana", role: "user", isActive: true, passwordHash: await hashPassword("senha-original-segura") } as any;
    const token = await signLocalSession(original);
    await expect(resolveSessionUser(token, async () => original)).resolves.toBe(original);

    const changed = { ...original, passwordHash: await hashPassword("senha-nova-bem-segura") };
    await expect(resolveSessionUser(token, async () => changed)).resolves.toBeNull();
  });

  it("recusa tokens de usuários inexistentes ou inativos e cookies ausentes", async () => {
    const user = { id: 4, username: "bia", role: "admin", isActive: true, passwordHash: await hashPassword("senha-original-segura") } as any;
    const token = await signLocalSession(user);
    await expect(resolveSessionUser(token, async () => null)).resolves.toBeNull();
    await expect(resolveSessionUser(undefined, async () => user)).resolves.toBeNull();
    await expect(resolveSessionUser("token-invalido", async () => user)).resolves.toBeNull();
  });

  it("gasta o custo do scrypt mesmo quando o usuário não existe", async () => {
    await expect(verifyPasswordOrDummy("qualquer-senha-123", null)).resolves.toBe(false);
    const hash = await hashPassword("senha-correta-123");
    await expect(verifyPasswordOrDummy("senha-correta-123", hash)).resolves.toBe(true);
  });
});

describe("limite de tentativas por IP", () => {
  it("bloqueia um IP que testa muitos usuários diferentes", () => {
    const now = 1_700_000_000_000;
    for (let attempt = 0; attempt < loginRateLimitConfig.maxFailuresPerIp; attempt += 1) {
      registerLoginFailure(`usuario${attempt}`, "10.0.0.9", now);
    }
    expect(() => assertLoginAllowed("usuario-novo", "10.0.0.9", now)).toThrow("Muitas tentativas");
    expect(() => assertLoginAllowed("usuario-novo", "10.0.0.10", now)).not.toThrow();
    expect(() => assertLoginAllowed("usuario-novo", "10.0.0.9", now + loginRateLimitConfig.blockMs + 1)).not.toThrow();
  });
});

describe("anexos", () => {
  it("rejeita anexo cujo conteúdo não corresponde ao tipo declarado", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "luminno-sec-"));
    temporaryDirectories.push(directory);
    process.env.UPLOAD_DIR = directory;
    await expect(saveLocalAttachment("nota.pdf", "application/pdf", Buffer.from("<html><script>alert(1)</script>"))).rejects.toThrow("PDF válido");
    await expect(saveLocalAttachment("foto.png", "image/png", Buffer.from("não é png"))).rejects.toThrow("não corresponde");
  });

  it("não expõe anexos pela rota pública de uploads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "luminno-sec-"));
    temporaryDirectories.push(directory);
    process.env.UPLOAD_DIR = directory;
    await mkdir(path.join(directory, "attachments"), { recursive: true });
    await mkdir(path.join(directory, "products"), { recursive: true });
    await writeFile(path.join(directory, "attachments", "contrato.pdf"), "%PDF-1.7 segredo");
    await writeFile(path.join(directory, "products", "foto.jpg"), "imagem");
    const app = express();
    registerLocalStorage(app);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const attachment = await fetch(`http://127.0.0.1:${port}/uploads/attachments/contrato.pdf`);
      expect(attachment.status).toBe(404);
      expect(await attachment.text()).not.toContain("segredo");
      const product = await fetch(`http://127.0.0.1:${port}/uploads/products/foto.jpg`);
      expect(product.status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("backup", () => {
  it("converte datas ISO do JSON de backup em Date sem tocar outros textos", () => {
    const revived = reviveBackupDates({ quotes: [{ issueDate: "2026-03-01T12:30:00.000Z", clientName: "2026-03-01", notes: "texto" }] });
    expect(revived.quotes[0]!.issueDate).toBeInstanceOf(Date);
    expect((revived.quotes[0]!.issueDate as unknown as Date).toISOString()).toBe("2026-03-01T12:30:00.000Z");
    expect(revived.quotes[0]!.clientName).toBe("2026-03-01");
    expect(revived.quotes[0]!.notes).toBe("texto");
  });
});

describe("numeração de orçamentos", () => {
  it("reconhece duplicidade de número embrulhada pelo drizzle", () => {
    const wrapped = Object.assign(new Error("Failed query: insert into `quotes`"), {
      cause: { code: "ER_DUP_ENTRY", errno: 1062, message: "Duplicate entry '6' for key 'quotes.quotes_quoteNumber_unique'" },
    });
    expect(isDuplicateQuoteNumberError(wrapped)).toBe(true);
  });
});
