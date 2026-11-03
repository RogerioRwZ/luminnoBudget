// Situação do backup diário, lida dos registros que o script luminno-backup
// grava no servidor (instalação pelo deploy/install-ubuntu.sh).

export type BackupState = "ok" | "stale" | "failed" | "unknown";

export type BackupStatus = {
  state: BackupState;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  error: string | null;
};

// O backup roda uma vez por dia; mais de 36 h sem sucesso é atraso.
export const BACKUP_STALE_HOURS = 36;

export function backupState(lastSuccessAt: Date | null, lastFailureAt: Date | null, now = new Date()): BackupState {
  if (lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt)) return "failed";
  if (!lastSuccessAt) return lastFailureAt ? "failed" : "unknown";
  return now.getTime() - lastSuccessAt.getTime() > BACKUP_STALE_HOURS * 60 * 60_000 ? "stale" : "ok";
}

export const BACKUP_STATE_LABELS: Record<BackupState, string> = {
  ok: "Em dia",
  stale: "Atrasado",
  failed: "Falhou",
  unknown: "Sem registro",
};

export const needsBackupAttention = (state: BackupState) => state === "stale" || state === "failed";
