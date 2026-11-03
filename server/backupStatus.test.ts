import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBackupStatus } from "./backupStatus";

let dir = "";
afterEach(async () => {
  delete process.env.BACKUP_STATUS_DIR;
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("leitura do status do backup", () => {
  it("lê o último sucesso e a falha gravados pelo luminno-backup", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "luminno-backup-"));
    process.env.BACKUP_STATUS_DIR = dir;
    expect((await readBackupStatus()).state).toBe("unknown");

    await writeFile(path.join(dir, "ok"), "2026-11-02T02:15:40-03:00\n");
    expect(await readBackupStatus(new Date("2026-11-02T12:00:00-03:00"))).toMatchObject({ state: "ok", error: null });

    await writeFile(path.join(dir, "erro"), "2026-11-03T02:15:10-03:00|falhou na etapa: cópia do banco de dados (mysqldump)\n");
    const failed = await readBackupStatus(new Date("2026-11-03T08:00:00-03:00"));
    expect(failed).toMatchObject({ state: "failed", error: "falhou na etapa: cópia do banco de dados (mysqldump)" });
    expect(failed.lastSuccessAt?.toISOString()).toBe("2026-11-02T05:15:40.000Z");
  });

  it("ignora conteúdo inválido", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "luminno-backup-"));
    await mkdir(dir, { recursive: true });
    process.env.BACKUP_STATUS_DIR = dir;
    await writeFile(path.join(dir, "ok"), "ontem");
    expect((await readBackupStatus()).state).toBe("unknown");
  });
});
