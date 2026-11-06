// @vitest-environment jsdom
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, readXlsx, XlsxError } from "./xlsx";
import { catalogTemplate, errorSheet } from "./catalogTemplate";
import { parseImportSheet } from "@shared/productImport";

// Monta um ZIP comprimido, como o Excel grava, com strings compartilhadas.
function compressedZip(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(encoder.encode(content));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBytes, end]));
}

describe("xlsx", () => {
  it("lê de volta o que gera, com acentos e caracteres especiais", async () => {
    const bytes = buildXlsx([{ name: "Produtos", header: true, textColumns: [0], rows: [["Ref", "Descrição"], ["007", "Lâmpada <E27> & \"quente\""], [12, 3.5]] }]);
    const [sheet] = await readXlsx(bytes);
    expect(sheet!.name).toBe("Produtos");
    expect(sheet!.rows).toEqual([["Ref", "Descrição"], ["007", "Lâmpada <E27> & \"quente\""], ["12", "3.5"]]);
  });

  it("lê arquivo comprimido com strings compartilhadas e células puladas", async () => {
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const bytes = compressedZip({
      "xl/workbook.xml": `<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Produtos" sheetId="1" r:id="rId9"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Target="/xl/worksheets/folha.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst ${ns}><si><t>Referência *</t></si><si><r><t>Lus</t></r><r><t>tre</t></r></si></sst>`,
      "xl/worksheets/folha.xml": `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="C3" t="s"><v>1</v></c><c r="D3"><v>199.9</v></c><c r="E3" t="str"><f>1+1</f><v>2</v></c><c r="F3" t="b"><v>1</v></c></row></sheetData></worksheet>`,
    });
    const [sheet] = await readXlsx(bytes);
    expect(sheet!.rows[0]).toEqual(["Referência *"]);
    expect(sheet!.rows[1]).toEqual([]);
    expect(sheet!.rows[2]).toEqual(["", "", "Lustre", "199.9", "2", "Sim"]);
  });

  it("recusa o que não é planilha", async () => {
    await expect(readXlsx(new TextEncoder().encode("isto é um CSV;não uma planilha"))).rejects.toBeInstanceOf(XlsxError);
  });

  it("o modelo traz as listas, os fornecedores e não importa o exemplo", async () => {
    const access = { canSeeCost: true, canStock: true };
    const spec = catalogTemplate(access, ["Luminare", "A & B"]);
    expect(spec.map((sheet) => sheet.name)).toEqual(["Produtos", "Fornecedores", "Instruções"]);
    const sheets = await readXlsx(buildXlsx(spec));
    expect(sheets[1]!.rows.map((row) => row[0])).toEqual(["Fornecedores cadastrados", "Luminare", "A & B"]);
    expect(spec[0]!.lists!.map((list) => list.formula)).toEqual(['"UN,PC,M,M2,CX,RL,KIT,PAR,CJ,KG,L"', '"Sim,Não"', "Fornecedores!$A$2:$A$3"]);
    const parsed = parseImportSheet(sheets[0]!.rows, { catalog: [], ...access });
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([]);
  });

  it("o modelo de Vendas não tem custo nem estoque", () => {
    const [products] = catalogTemplate({ canSeeCost: false, canStock: false }, []);
    expect(products!.rows[0]).not.toContain("Preço de custo");
    expect(products!.rows[0]).not.toContain("Quantidade em estoque");
    expect(products!.lists).toHaveLength(2);
  });

  it("a planilha de erros volta a ser lida", async () => {
    const access = { canSeeCost: true, canStock: true };
    const first = parseImportSheet([["Referência *", "Descrição curta *", "Valor de venda"], ["A", "", "199,90"]], { catalog: [], ...access });
    const spec = errorSheet(access, [{ row: first.rows[0]!, reasons: first.rows[0]!.problems }], []);
    const again = parseImportSheet((await readXlsx(buildXlsx(spec)))[0]!.rows, { catalog: [], ...access });
    expect(again.rows[0]!.data).toMatchObject({ reference: "A", unitPrice: 199.9 });
    expect(again.rows[0]!.problems[0]).toContain("descrição curta");
  });
});
