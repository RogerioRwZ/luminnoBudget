import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLocalPdfPath } from "./localStorage";

// PDFs novos não são gravados em disco (o histórico guarda os dados); os
// arquivos antigos continuam baixáveis por este caminho.
describe("PDFs antigos do histórico", () => {
  it("resolve só arquivos .pdf dentro da pasta do histórico", () => {
    process.env.PDF_HISTORY_DIR = "/srv/luminno/pdf-history";
    expect(getLocalPdfPath("orcamento-42-abc.pdf")).toBe(path.join("/srv/luminno/pdf-history", "orcamento-42-abc.pdf"));
    expect(() => getLocalPdfPath("../segredo.pdf")).toThrow("Chave de PDF inválida");
    expect(() => getLocalPdfPath("arquivo.txt")).toThrow("Chave de PDF inválida");
  });
});
