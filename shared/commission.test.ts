import { describe, expect, it } from "vitest";
import { commissionAmount, commissionBase, professionalKey } from "./commission";

describe("comissão", () => {
  it("junta o mesmo profissional digitado de jeitos diferentes", () => {
    expect(professionalKey("  Ana   Souza ")).toBe(professionalKey("ana souza"));
    expect(professionalKey(null)).toBe("");
  });

  it("paga sobre o recebido, sem a parte do frete", () => {
    expect(commissionBase(100, 200, 20)).toBe(90);
    expect(commissionBase(0, 200, 20)).toBe(0);
    expect(commissionBase(50, 0, 0)).toBe(0);
    expect(commissionAmount(90, 5)).toBe(4.5);
    expect(commissionAmount(90, -1)).toBe(0);
  });
});
