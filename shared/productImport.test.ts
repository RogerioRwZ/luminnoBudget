import { describe, expect, it } from "vitest";
import { IMPORT_COLUMNS, IMPORT_EXAMPLE_REFERENCE, importColumnsFor, parseImportNumber, parseImportSheet, photoReport, unknownSuppliers } from "./productImport";

const header = IMPORT_COLUMNS.map((column) => column.header);
const index = (key: string) => IMPORT_COLUMNS.findIndex((column) => column.key === key);
const line = (values: Record<string, string>) => {
  const row = header.map(() => "");
  for (const [key, value] of Object.entries(values)) row[index(key)] = value;
  return row;
};
const parse = (rows: string[][], options: Partial<Parameters<typeof parseImportSheet>[1]> = {}) => parseImportSheet([header, ...rows], { catalog: [], canSeeCost: true, canStock: true, ...options });

describe("parseImportNumber", () => {
  it("entende a vírgula brasileira e o número da célula", () => {
    expect(parseImportNumber("199,90")).toBe(199.9);
    expect(parseImportNumber("1.234,50")).toBe(1234.5);
    expect(parseImportNumber("R$ 10")).toBe(10);
    expect(parseImportNumber("199.9")).toBe(199.9);
    expect(parseImportNumber("1E+2")).toBe(100);
    expect(parseImportNumber("")).toBeUndefined();
    expect(parseImportNumber("caro")).toBeNaN();
  });
});

describe("parseImportSheet", () => {
  it("lê os campos do cadastro e pula a linha de exemplo e as vazias", () => {
    const { rows } = parse([
      line({ reference: IMPORT_EXAMPLE_REFERENCE, shortDescription: "x" }),
      [],
      line({ reference: "abc-1", shortDescription: "Lustre", fullDescription: "Lustre completo", barcode: "7891234567895", unit: "pc", supplierName: "ACME", unitPrice: "199,90", costPrice: "80", initialStock: "15,5", reorderPoint: "3", warrantyMonths: "24", active: "Não", photo: "a.jpg" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.line).toBe(4);
    expect(rows[0]!.problems).toEqual([]);
    expect(rows[0]!.photo).toBe("a.jpg");
    expect(rows[0]!.data).toMatchObject({ shortDescription: "Lustre", fullDescription: "Lustre completo", barcode: "7891234567895", unit: "PC", supplierName: "ACME", unitPrice: 199.9, costPrice: 80, initialStock: 15.5, reorderPoint: 3, warrantyMonths: 24, active: false });
  });

  it("não se confunde com o ruído de ponto flutuante da planilha", () => {
    const { rows } = parse([line({ reference: "A", shortDescription: "B", unitPrice: "199.90000000000001" })]);
    expect(rows[0]!.problems).toEqual([]);
    expect(rows[0]!.data.unitPrice).toBe(199.9);
  });

  it("aponta cada valor inválido", () => {
    const { rows } = parse([
      line({ shortDescription: "sem referência" }),
      line({ reference: "B" }),
      line({ reference: "C", shortDescription: "x", unit: "12" }),
      line({ reference: "D", shortDescription: "x", unitPrice: "caro" }),
      line({ reference: "E", shortDescription: "x", unitPrice: "1,234" }),
      line({ reference: "F", shortDescription: "x", unitPrice: "-1" }),
      line({ reference: "G", shortDescription: "x", active: "talvez" }),
      line({ reference: "H", shortDescription: "x", warrantyMonths: "1,5" }),
      line({ reference: "I", shortDescription: "x", barcode: "7.89123E+12" }),
    ]);
    expect(rows.every((row) => row.problems.length > 0)).toBe(true);
  });

  it("recusa repetição na planilha e código de barras de outro produto", () => {
    const catalog = [{ id: 1, reference: "OLD", barcode: "111", shortDescription: "Antigo" }];
    const { rows } = parse([
      line({ reference: "abc", shortDescription: "1", barcode: "222" }),
      line({ reference: "ABC", shortDescription: "2" }),
      line({ reference: "D", shortDescription: "3", barcode: "222" }),
      line({ reference: "E", shortDescription: "4", barcode: "111" }),
    ], { catalog });
    expect(rows[0]!.problems).toEqual([]);
    expect(rows[1]!.problems[0]).toContain("linha 2");
    expect(rows[2]!.problems[0]).toContain("linha 2");
    expect(rows[3]!.problems[0]).toContain("Antigo");
  });

  it("reconhece produto do catálogo, sem exigir descrição e sem mexer no estoque", () => {
    const catalog = [{ id: 7, reference: "OLD", barcode: "111", shortDescription: "Antigo" }];
    const { rows } = parse([line({ reference: "old", barcode: "111", initialStock: "9" })], { catalog });
    expect(rows[0]!.existing).toEqual({ id: 7, shortDescription: "Antigo" });
    expect(rows[0]!.problems).toEqual([]);
    expect(rows[0]!.data.initialStock).toBeUndefined();
    expect(rows[0]!.warnings[0]).toContain("estoque não muda");
  });

  it("não aproveita custo nem estoque de quem não pode usá-los", () => {
    const { rows } = parse([line({ reference: "A", shortDescription: "B", costPrice: "10", initialStock: "5", unitPrice: "20" })], { canSeeCost: false, canStock: false });
    expect(rows[0]!.data.costPrice).toBeUndefined();
    expect(rows[0]!.data.initialStock).toBeUndefined();
    expect(importColumnsFor({ canSeeCost: false, canStock: false }).map((column) => column.key)).not.toEqual(expect.arrayContaining(["costPrice"]));
    expect(importColumnsFor({ canSeeCost: false, canStock: false }).map((column) => column.key)).not.toContain("initialStock");
  });

  it("guarda texto com cara de fórmula como texto", () => {
    const { rows } = parse([line({ reference: "A", shortDescription: "=HYPERLINK(\"x\")" })]);
    expect(rows[0]!.data.shortDescription).toBe("=HYPERLINK(\"x\")");
  });

  it("recusa planilha sem a coluna Referência", () => {
    expect(parseImportSheet([["Nome", "Preço"]], { catalog: [], canSeeCost: true, canStock: true }).error).toContain("Referência");
  });

  it("ignora colunas extras, como a de problema da planilha de erros", () => {
    const { rows, error } = parseImportSheet([["Problema", "Referência *", "Descrição curta *"], ["motivo", "A", "B"]], { catalog: [], canSeeCost: true, canStock: true });
    expect(error).toBeNull();
    expect(rows[0]!.data).toMatchObject({ reference: "A", shortDescription: "B" });
  });
});

describe("unknownSuppliers", () => {
  it("junta maiúsculas e minúsculas e ignora os cadastrados", () => {
    const { rows } = parse([
      line({ reference: "A", shortDescription: "1", supplierName: "ACME" }),
      line({ reference: "B", shortDescription: "2", supplierName: "acme" }),
      line({ reference: "C", shortDescription: "3", supplierName: "luminare" }),
    ]);
    expect(unknownSuppliers(rows, ["Luminare"])).toEqual([{ name: "ACME", lines: [2, 3] }]);
  });
});

describe("photoReport", () => {
  it("compara pelo nome e aponta foto faltando e sobrando", () => {
    const { rows } = parse([
      line({ reference: "A", shortDescription: "1", photo: "C:\\fotos\\Lustre.JPG" }),
      line({ reference: "B", shortDescription: "2", photo: "falta.png" }),
    ]);
    expect(photoReport(rows, ["lustre.jpg", "sobra.webp"])).toEqual({ missing: [{ line: 3, photo: "falta.png" }], unused: ["sobra.webp"] });
  });
});
