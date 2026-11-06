import { IMPORT_EXAMPLE_REFERENCE, IMPORT_MAX_ROWS, IMPORT_UNIT_LIST, importColumnsFor, type ImportKey, type ImportRow } from "@shared/productImport";
import type { SheetSpec } from "./xlsx";

type Access = { canSeeCost: boolean; canStock: boolean };

const EXAMPLE: Record<ImportKey, string> = {
  reference: IMPORT_EXAMPLE_REFERENCE,
  shortDescription: "Lustre de cristal 40 cm",
  fullDescription: "Lustre de cristal K9, 40 cm, base dourada, 6 lâmpadas E14",
  barcode: "7891234567895",
  unit: "UN",
  supplierName: "",
  unitPrice: "199,90",
  costPrice: "80,00",
  initialStock: "15",
  reorderPoint: "3",
  warrantyMonths: "12",
  active: "Sim",
  photo: "lustre-01.jpg",
};

function productsSheet(access: Access, rows: string[][], supplierCount: number): SheetSpec {
  const columns = importColumnsFor(access);
  const position = (key: ImportKey) => columns.findIndex((column) => column.key === key);
  const toRow = IMPORT_MAX_ROWS + 2;
  return {
    name: "Produtos",
    header: true,
    widths: columns.map((column) => column.width),
    textColumns: columns.flatMap((column, index) => ("text" in column && column.text ? [index] : [])),
    rows: [columns.map((column) => column.header), ...rows],
    lists: [
      { column: position("unit"), formula: `"${IMPORT_UNIT_LIST}"`, toRow },
      { column: position("active"), formula: `"Sim,Não"`, toRow },
      ...(supplierCount ? [{ column: position("supplierName"), formula: `Fornecedores!$A$2:$A$${supplierCount + 1}`, toRow }] : []),
    ],
  };
}

export function catalogTemplate(access: Access, suppliers: string[]): SheetSpec[] {
  const columns = importColumnsFor(access);
  return [
    productsSheet(access, [columns.map((column) => EXAMPLE[column.key])], suppliers.length),
    { name: "Fornecedores", header: true, widths: [40], rows: [["Fornecedores cadastrados"], ...suppliers.map((name) => [name])] },
    {
      name: "Instruções",
      header: true,
      widths: [26, 90],
      rows: [
        ["Coluna", "Como preencher"],
        ...columns.map((column) => [column.header, column.note]),
        [],
        ["Linha de exemplo", `A linha "${IMPORT_EXAMPLE_REFERENCE}" é só um modelo: o sistema não a importa.`],
        ["Limite", `Até ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")} produtos por planilha.`],
        ["Código interno", "É criado pelo sistema. Não precisa de coluna."],
        ["Importar", "Em Catálogo > Importar planilha: envie este arquivo e selecione as fotos, ou envie um único .zip com a planilha e as fotos. O sistema mostra a conferência antes de gravar."],
      ],
    },
  ];
}

// As linhas recusadas, no mesmo formato, para corrigir e enviar de novo.
export function errorSheet(access: Access, failed: Array<{ row: ImportRow; reasons: string[] }>, suppliers: string[]): SheetSpec[] {
  const columns = importColumnsFor(access);
  const base = productsSheet(access, failed.map(({ row, reasons }) => [...columns.map((column) => row.raw[column.key] ?? ""), reasons.join(" ")]), suppliers.length);
  base.rows[0] = [...columns.map((column) => column.header), "Problema (pode manter esta coluna)"];
  base.widths = [...columns.map((column) => column.width), 60];
  return [base, { name: "Fornecedores", header: true, widths: [40], rows: [["Fornecedores cadastrados"], ...suppliers.map((name) => [name])] }];
}
