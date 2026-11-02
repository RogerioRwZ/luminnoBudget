import { describe, expect, it } from "vitest";
import { quotePdfFileName } from "./quoteFileName";

describe("quotePdfFileName", () => {
  it("usa número, cliente e profissional", () => {
    expect(quotePdfFileName({ quoteNumber: 12, clientName: "Maria Silva", professional: "Arq. Paulo" })).toBe("Orçamento 0012 - Maria Silva - Arq. Paulo.pdf");
  });

  it("omite o profissional quando não informado", () => {
    expect(quotePdfFileName({ quoteNumber: 7, clientName: "Maria Silva", professional: "  " })).toBe("Orçamento 0007 - Maria Silva.pdf");
  });

  it("remove caracteres inválidos em nomes de arquivo", () => {
    expect(quotePdfFileName({ quoteNumber: 3, clientName: "Ana/Cia: \"Loja\"", professional: null })).toBe("Orçamento 0003 - Ana Cia Loja.pdf");
  });
});
