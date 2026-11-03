import { describe, expect, it } from "vitest";
import { parsePrice } from "./VariantRows";

describe("preço da variação", () => {
  it("aceita vírgula, ponto e milhar", () => {
    expect(parsePrice("149,9")).toBe(149.9);
    expect(parsePrice("149.90")).toBe(149.9);
    expect(parsePrice("1.234,56")).toBe(1234.56);
    expect(parsePrice("abc")).toBe(0);
  });
});
