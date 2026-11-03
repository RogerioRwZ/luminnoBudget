import { describe, expect, it } from "vitest";
import { nextProductCode } from "./productCodes";

describe("nextProductCode", () => {
  it("inicia em 1 e incrementa o maior código numérico existente", () => {
    expect(nextProductCode([])).toBe("1");
    expect(nextProductCode(["1", "2", "9"])).toBe("10");
    expect(nextProductCode(["1", "manual", "4"])).toBe("5");
  });
});

import { barcodeProblem, findProductByScan, matchesProductSearch, normalizeBarcode, referenceProblem } from "./productCodes";

describe("referência e código de barras", () => {
  it("referência é obrigatória e aceita letras, números e símbolos", () => {
    expect(referenceProblem("  ")).toMatch(/Informe a referência/);
    expect(referenceProblem("LM-100/PT #2.5")).toBeNull();
    expect(referenceProblem("A".repeat(65))).toMatch(/no máximo 64/);
    // Tabulação e quebra de linha viram espaço; outros caracteres de controle são recusados.
    expect(referenceProblem("LM\t100")).toBeNull();
    expect(referenceProblem("LM\u0007100")).toMatch(/quebras de linha/);
  });

  it("código de barras é opcional, sem espaços e sem acentos", () => {
    expect(barcodeProblem("")).toBeNull();
    expect(normalizeBarcode(" 789 1234 567890 ")).toBe("7891234567890");
    expect(barcodeProblem("ABC-123/9")).toBeNull();
    expect(barcodeProblem("AÇÃO")).toMatch(/sem acento/);
  });

  const products = [
    { code: "12", reference: "LM-100/PT", shortDescription: "Pendente Arco — Preto · 3000K", supplierName: "Luminare", barcode: "7891234567890" },
    { code: "13", reference: "SP-7W", shortDescription: "Spot Embutir 7W", supplierName: "Stella", barcode: null },
  ];

  it("busca por referência, descrição e código de barras, sem acento e em qualquer ordem", () => {
    const find = (query: string) => products.filter((product) => matchesProductSearch(product, query)).map((product) => product.code);
    expect(find("lm-100")).toEqual(["12"]);
    expect(find("preto pendente")).toEqual(["12"]);
    expect(find("embutir")).toEqual(["13"]);
    expect(find("4567890")).toEqual(["12"]);
    expect(find("#13")).toEqual(["13"]);
    expect(find("")).toEqual(["12", "13"]);
  });

  it("leitura exata acha pelo código de barras ou pela referência", () => {
    expect(findProductByScan(products, "7891234567890")?.code).toBe("12");
    expect(findProductByScan(products, "sp-7w")?.code).toBe("13");
    expect(findProductByScan(products, "789123")).toBeUndefined();
  });
});
