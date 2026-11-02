import { describe, expect, it } from "vitest";
import { buildFollowUpMessage, isFollowUpDue } from "./followUp";

describe("isFollowUpDue", () => {
  const now = new Date(2026, 10, 2, 9, 0);
  it("vence no próprio dia e nos dias anteriores", () => {
    expect(isFollowUpDue(new Date(2026, 10, 2, 18, 0), now)).toBe(true);
    expect(isFollowUpDue(new Date(2026, 9, 30), now)).toBe(true);
  });
  it("não vence amanhã nem sem data", () => {
    expect(isFollowUpDue(new Date(2026, 10, 3, 0, 1), now)).toBe(false);
    expect(isFollowUpDue(null, now)).toBe(false);
  });
});

describe("buildFollowUpMessage", () => {
  it("cita o orçamento e o valor", () => {
    const text = buildFollowUpMessage({ brand: "Luminno", quoteNumber: 12, clientName: "Marina", total: 1500 });
    expect(text).toContain("#12");
    expect(text).toMatch(/R\$\s1\.500,00/);
  });
});
