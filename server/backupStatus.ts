import { readFile } from "node:fs/promises";
import path from "node:path";
import { backupState, type BackupStatus } from "../shared/backupStatus";
import { getUploadDirectory } from "./localStorage";

// O luminno-backup grava em <dados>/backup-status/ o horário do último
// sucesso (ok) e da última falha (erro: "horário|mensagem"). Sem a pasta
// (instalação manual antiga, desenvolvimento), a situação fica "sem registro".
export function getBackupStatusDirectory() {
  return path.resolve(process.env.BACKUP_STATUS_DIR || path.join(path.dirname(getUploadDirectory()), "backup-status"));
}

async function readText(file: string) {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function readBackupStatus(now = new Date()): Promise<BackupStatus> {
  const directory = getBackupStatusDirectory();
  const [ok, failure] = await Promise.all([readText(path.join(directory, "ok")), readText(path.join(directory, "erro"))]);
  const [failedAt, ...message] = (failure ?? "").split("|");
  const lastSuccessAt = parseDate(ok);
  const lastFailureAt = parseDate(failedAt);
  return {
    state: backupState(lastSuccessAt, lastFailureAt, now),
    lastSuccessAt,
    lastFailureAt,
    error: lastFailureAt ? message.join("|").trim().slice(0, 300) || null : null,
  };
}
