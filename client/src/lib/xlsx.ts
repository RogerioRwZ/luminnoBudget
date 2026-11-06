// Gera e lê planilhas .xlsx no navegador, sem biblioteca: o arquivo é um ZIP de
// XMLs. Só o que o catálogo usa: texto, listas nas células e várias abas.

// ------------------------------------------------------------- ZIP
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 01/01/1980: data 0 não existe no formato e alguns leitores reclamam.
const DOS_DATE = 0x0021;

function zipStored(files: Array<{ name: string; data: Uint8Array }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(12, DOS_DATE, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, file.data.length, true);
    header.setUint32(22, file.data.length, true);
    header.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(header.buffer), name, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }
  return output;
}

const MAX_UNZIPPED = 100 * 1024 * 1024;

const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

// O Windows antigo grava o nome em CP437; o Mac grava UTF-8 sem avisar no arquivo.
function zipName(bytes: Uint8Array, utf8Flag: boolean) {
  try {
    return new TextDecoder("utf-8", { fatal: !utf8Flag }).decode(bytes);
  } catch {
    return Array.from(bytes, (byte) => (byte < 128 ? String.fromCharCode(byte) : CP437[byte - 128]!)).join("");
  }
}

export type ZipEntry = { name: string; method: number; compressed: number; size: number; local: number; encrypted: boolean };

export function listZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 66_000); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("not-zip");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  if (count === 0xffff || cursor === 0xffffffff || cursor + 46 * count > bytes.length) throw new Error("not-zip");
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("not-zip");
    const flags = view.getUint16(cursor + 8, true);
    const nameLength = view.getUint16(cursor + 28, true);
    entries.push({
      name: zipName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), (flags & 0x0800) !== 0),
      method: view.getUint16(cursor + 10, true),
      compressed: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
      local: view.getUint32(cursor + 42, true),
      encrypted: (flags & 1) !== 0,
    });
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return entries;
}

// O tamanho declarado no ZIP pode mentir: o limite vale para o que sai de verdade.
export async function zipEntryData(bytes: Uint8Array, entry: ZipEntry, limit: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.local + 30 > bytes.length || view.getUint32(entry.local, true) !== 0x04034b50) throw new Error("not-zip");
  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
  const data = bytes.subarray(start, start + entry.compressed);
  if (entry.method === 0) {
    if (data.length > limit) throw new Error("too-big");
    return data;
  }
  if (entry.method !== 8) throw new Error("not-zip");
  const reader = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("too-big");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

async function unzip(bytes: Uint8Array) {
  const files = new Map<string, Uint8Array>();
  let left = MAX_UNZIPPED;
  for (const entry of listZip(bytes)) {
    // Só as partes de texto da planilha: fotos e o resto não interessam.
    if (!/\.(xml|rels)$/i.test(entry.name)) continue;
    const data = await zipEntryData(bytes, entry, left);
    left -= data.length;
    files.set(entry.name, data);
  }
  return files;
}

// ------------------------------------------------------------- escrita
export type SheetSpec = {
  name: string;
  rows: Array<Array<string | number | null | undefined>>;
  widths?: number[];
  // Colunas (a partir de 0) em formato texto: o Excel não estraga código de barras.
  textColumns?: number[];
  header?: boolean;
  // formula: "Fornecedores!$A$2:$A$9" ou "\"Sim,Não\"". Aceita valor fora da lista.
  lists?: Array<{ column: number; formula: string; toRow: number }>;
};

const escapeXml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

const columnName = (index: number) => {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};

function sheetXml(sheet: SheetSpec) {
  const text = new Set(sheet.textColumns ?? []);
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      if (value === null || value === undefined || value === "") return "";
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = sheet.header && rowIndex === 0 ? 1 : text.has(columnIndex) ? 2 : 0;
      if (typeof value === "number" && !text.has(columnIndex)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
    });
    return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
  });
  const widths = sheet.widths ?? [];
  const columns = Array.from(new Set([...Array.from(widths.keys()), ...Array.from(text)])).sort((first, second) => first - second);
  const cols = columns.length ? `<cols>${columns.map((index) => `<col min="${index + 1}" max="${index + 1}" width="${widths[index] ?? 14}" customWidth="1"${text.has(index) ? ` style="2"` : ""}/>`).join("")}</cols>` : "";
  const pane = sheet.header ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  const lists = sheet.lists?.length
    ? `<dataValidations count="${sheet.lists.length}">${sheet.lists.map((list) => `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${columnName(list.column)}2:${columnName(list.column)}${list.toRow}"><formula1>${escapeXml(list.formula)}</formula1></dataValidation>`).join("")}</dataValidations>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows.join("")}</sheetData>${lists}</worksheet>`;
}

export function buildXlsx(sheets: SheetSpec[]) {
  const encoder = new TextEncoder();
  const file = (name: string, content: string) => ({ name, data: encoder.encode(content) });
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
  const ns = "http://schemas.openxmlformats.org";
  return zipStored([
    file("[Content_Types].xml", `${xml}<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    file("_rels/.rels", `${xml}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    file("xl/workbook.xml", `${xml}<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`),
    file("xl/_rels/workbook.xml.rels", `${xml}<Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    file("xl/styles.xml", `${xml}<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4D842"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    ...sheets.map((sheet, index) => file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet))),
  ]);
}

export function downloadXlsx(fileName: string, sheets: SheetSpec[]) {
  const bytes = buildXlsx(sheets);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------- leitura
const parseXml = (bytes: Uint8Array) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
const all = (root: Document | Element, name: string) => Array.from(root.getElementsByTagName("*")).filter((node) => node.localName === name);
const direct = (root: Element, name: string) => Array.from(root.children).filter((node) => node.localName === name);

const columnIndex = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  return Array.from(letters).reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

export class XlsxError extends Error {}

// Devolve as abas como texto, célula a célula. Número vem com ponto decimal.
export async function readXlsx(bytes: Uint8Array) {
  let files: Map<string, Uint8Array>;
  try {
    files = await unzip(bytes);
  } catch (error) {
    throw new XlsxError(error instanceof Error && error.message === "too-big" ? "A planilha é grande demais." : "Este arquivo não é uma planilha .xlsx válida. No Excel, use Salvar como > Pasta de Trabalho do Excel (.xlsx).");
  }
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new XlsxError("Este arquivo não é uma planilha .xlsx válida.");
  const shared = files.get("xl/sharedStrings.xml");
  const strings = shared ? all(parseXml(shared), "si").map((item) => all(item, "t").filter((node) => node.parentElement?.localName !== "rPh").map((node) => node.textContent ?? "").join("")) : [];
  const targets = new Map(all(parseXml(rels), "Relationship").map((node) => [node.getAttribute("Id"), node.getAttribute("Target") ?? ""]));
  return all(parseXml(workbook), "sheet").map((sheet) => {
    const id = sheet.getAttribute("r:id") ?? Array.from(sheet.attributes).find((attribute) => attribute.localName === "id")?.value;
    const target = (targets.get(id ?? "") ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const part = files.get(`xl/${target}`);
    const rows: string[][] = [];
    if (part) {
      for (const row of all(parseXml(part), "row")) {
        const rowIndex = Number(row.getAttribute("r") ?? rows.length + 1) - 1;
        const cells: string[] = [];
        for (const cell of direct(row, "c")) {
          const type = cell.getAttribute("t");
          const raw = direct(cell, "v")[0]?.textContent ?? "";
          const value = type === "s" ? strings[Number(raw)] ?? "" : type === "inlineStr" ? all(cell, "t").map((node) => node.textContent ?? "").join("") : type === "b" ? (raw === "1" ? "Sim" : "Não") : raw;
          cells[columnIndex(cell.getAttribute("r") ?? "A1")] = value;
        }
        rows[rowIndex] = Array.from(cells, (value) => value ?? "");
      }
    }
    return { name: sheet.getAttribute("name") ?? "", rows: Array.from(rows, (row) => row ?? []) };
  });
}
