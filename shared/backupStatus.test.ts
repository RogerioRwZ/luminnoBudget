import { describe, expect, it } from "vitest";
import { backupState, needsBackupAttention } from "./backupStatus";

describe("situação do backup", () => {
  const now = new Date(2026, 10, 3, 10);
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60_000);

  it("fica em dia até 36 h depois do último sucesso", () => {
    expect(backupState(hoursAgo(8), null, now)).toBe("ok");
    expect(backupState(hoursAgo(37), null, now)).toBe("stale");
  });

  it("aponta falha mais recente que o último sucesso", () => {
    expect(backupState(hoursAgo(32), hoursAgo(8), now)).toBe("failed");
    expect(backupState(hoursAgo(8), hoursAgo(32), now)).toBe("ok");
    expect(backupState(null, hoursAgo(2), now)).toBe("failed");
  });

  it("sem registro não pede atenção", () => {
    expect(backupState(null, null, now)).toBe("unknown");
    expect(needsBackupAttention("unknown")).toBe(false);
    expect(needsBackupAttention("stale")).toBe(true);
  });
});
