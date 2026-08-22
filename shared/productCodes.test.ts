import { describe, expect, it } from "vitest";
import { nextProductCode } from "./productCodes";

describe("nextProductCode", () => {
  it("inicia em 1 e incrementa o maior código numérico existente", () => {
    expect(nextProductCode([])).toBe("1");
    expect(nextProductCode(["1", "2", "9"])).toBe("10");
    expect(nextProductCode(["1", "manual", "4"])).toBe("5");
  });
});
