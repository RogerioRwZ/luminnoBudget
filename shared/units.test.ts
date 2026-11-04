import { describe, expect, it } from "vitest";
import { cleanUnit, isNumericUnit } from "./units";

describe("unidade do produto", () => {
  it("reconhece número digitado no lugar da unidade", () => {
    expect(isNumericUnit("25")).toBe(true);
    expect(isNumericUnit("2,5")).toBe(true);
    expect(isNumericUnit("UN")).toBe(false);
    expect(isNumericUnit("M2")).toBe(false);
  });
  it("mostra UN no lugar de número ou vazio", () => {
    expect(cleanUnit("380")).toBe("UN");
    expect(cleanUnit("")).toBe("UN");
    expect(cleanUnit("CX")).toBe("CX");
  });
});
