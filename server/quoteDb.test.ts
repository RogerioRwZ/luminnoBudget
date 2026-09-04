import { describe, expect, it } from "vitest";
import { isDuplicateQuoteNumberError } from "./quoteDb";

describe("isDuplicateQuoteNumberError", () => {
  it("reconhece uma violação de unicidade do quoteNumber (mysql2)", () => {
    expect(
      isDuplicateQuoteNumberError({
        code: "ER_DUP_ENTRY",
        errno: 1062,
        message: "Duplicate entry '5' for key 'quotes.quoteNumber'",
      })
    ).toBe(true);
  });

  it("também reconhece pelo errno quando o code não está presente", () => {
    expect(isDuplicateQuoteNumberError({ errno: 1062 })).toBe(true);
  });

  it("ignora violações de unicidade de outras colunas (ex.: barcode de produto)", () => {
    expect(
      isDuplicateQuoteNumberError({
        code: "ER_DUP_ENTRY",
        errno: 1062,
        message: "Duplicate entry '789' for key 'products.barcode'",
      })
    ).toBe(false);
  });

  it("ignora erros que não são de chave duplicada", () => {
    expect(isDuplicateQuoteNumberError(new Error("Banco de dados indisponível."))).toBe(false);
    expect(isDuplicateQuoteNumberError(null)).toBe(false);
    expect(isDuplicateQuoteNumberError(undefined)).toBe(false);
  });
});
