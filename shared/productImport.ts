import { barcodeProblem, foldText, normalizeBarcode, normalizeReference, referenceProblem } from "./productCodes";
import { isNumericUnit, NUMERIC_UNIT_MESSAGE, UNIT_OPTIONS } from "./units";

// Colunas da planilha: os mesmos campos do cadastro do produto.
export const IMPORT_COLUMNS = [
  { key: "reference", header: "Referência *", width: 18, text: true, note: "Obrigatória. Letras, números e símbolos. Não pode repetir." },
  { key: "shortDescription", header: "Descrição curta *", width: 34, note: "Obrigatória em produto novo. Vai para o orçamento." },
  { key: "fullDescription", header: "Descrição completa", width: 44, note: "Opcional. Vai para a separação." },
  { key: "barcode", header: "Código de barras", width: 18, text: true, note: "Opcional. Não pode repetir." },
  { key: "unit", header: "Unidade de medida", width: 12, note: "Escolha na lista ou digite outra. Em branco: UN. Não é o estoque." },
  { key: "supplierName", header: "Fornecedor", width: 26, note: "Escolha na lista ou digite um novo: o sistema pergunta o que fazer ao importar." },
  { key: "unitPrice", header: "Valor de venda", width: 12, note: "Ex.: 199,90" },
  { key: "costPrice", header: "Preço de custo", width: 12, note: "Opcional. Ex.: 80,00" },
  { key: "initialStock", header: "Quantidade em estoque", width: 12, note: "Só para produto novo. Entra como Entrada no histórico. Ex.: 15,5" },
  { key: "reorderPoint", header: "Ponto de reposição", width: 12, note: "Opcional." },
  { key: "warrantyMonths", header: "Garantia (meses)", width: 10, note: "Em branco: usa a garantia padrão da loja." },
  { key: "active", header: "Ativo", width: 8, note: "Sim ou Não. Em branco: Sim." },
  { key: "photo", header: "Foto", width: 24, text: true, note: "Nome do arquivo, como lustre-01.jpg. Selecione as fotos ao importar." },
] as const;
export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];

// Sem custo e estoque para quem não pode vê-los ou lançá-los.
export function importColumnsFor(access: { canSeeCost: boolean; canStock: boolean }) {
  return IMPORT_COLUMNS.filter((column) => (column.key !== "costPrice" || access.canSeeCost) && (column.key !== "initialStock" || access.canStock));
}

export const IMPORT_EXAMPLE_REFERENCE = "EXEMPLO (apague)";
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_UNIT_LIST = UNIT_OPTIONS.map((option) => option.value).join(",");

export type ImportRowData = {
  line: number;
  reference: string;
  shortDescription?: string;
  fullDescription?: string;
  barcode?: string;
  unit?: string;
  supplierName?: string;
  unitPrice?: number;
  costPrice?: number;
  initialStock?: number;
  reorderPoint?: number;
  warrantyMonths?: number;
  active?: boolean;
  imageUrl?: string;
  imageKey?: string;
};
export type ImportRow = {
  line: number;
  raw: Partial<Record<ImportKey, string>>;
  data: ImportRowData;
  photo: string | null;
  existing: { id: number; shortDescription: string } | null;
  problems: string[];
  warnings: string[];
};
export type CatalogEntry = { id: number; reference: string | null; barcode: string | null; shortDescription: string };

const headerKey = (value: string) => foldText(value.replace(/\*/g, "")).trim().replace(/\s+/g, " ");
const ALIASES: Record<string, ImportKey> = { "valor unitario": "unitPrice", "preco de venda": "unitPrice", "unidade": "unit", "garantia": "warrantyMonths", "estoque": "initialStock" };

export function mapImportHeaders(header: string[]) {
  const known = new Map<string, ImportKey>(IMPORT_COLUMNS.map((column) => [headerKey(column.header), column.key]));
  const map = new Map<number, ImportKey>();
  header.forEach((cell, index) => {
    const key = known.get(headerKey(cell ?? "")) ?? ALIASES[headerKey(cell ?? "")];
    if (key) map.set(index, key);
  });
  return map;
}

// "199,90", "1.234,50", "R$ 10" e o número puro da célula (199.9).
export function parseImportNumber(text: string) {
  const clean = text.replace(/\s|R\$/g, "");
  if (!clean) return undefined;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  return /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(normalized) ? Number(normalized) : Number.NaN;
}

// A planilha guarda 199.9 como 199.90000000000001: isso ainda são dois decimais.
const hasCents = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
const toCents = (value: number) => Math.round(value * 100) / 100;
const key = (value: string) => foldText(value).trim();

export function parseImportSheet(rows: string[][], context: { catalog: CatalogEntry[]; canSeeCost: boolean; canStock: boolean }) {
  const headerIndex = rows.findIndex((row) => row?.some((cell) => headerKey(cell ?? "") === "referencia"));
  if (headerIndex < 0) return { error: "Não achei a coluna Referência. Use a planilha modelo baixada do sistema.", rows: [] as ImportRow[] };
  const headers = mapImportHeaders(rows[headerIndex]!);
  const byReference = new Map(context.catalog.flatMap((entry) => (entry.reference ? [[key(entry.reference), entry] as const] : [])));
  const byBarcode = new Map(context.catalog.flatMap((entry) => (entry.barcode ? [[entry.barcode, entry] as const] : [])));
  const seenReferences = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const parsed: ImportRow[] = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index] ?? [];
    const raw: ImportRow["raw"] = {};
    headers.forEach((field, column) => {
      const value = (cells[column] ?? "").trim();
      if (value) raw[field] = value;
    });
    if (!Object.keys(raw).length || raw.reference === IMPORT_EXAMPLE_REFERENCE) continue;
    const line = index + 1;
    const problems: string[] = [];
    const warnings: string[] = [];
    const reference = normalizeReference(raw.reference ?? "");
    const referenceError = referenceProblem(reference);
    if (referenceError) problems.push(referenceError);
    const existing = reference ? byReference.get(key(reference)) ?? null : null;
    if (reference) {
      const repeated = seenReferences.get(key(reference));
      if (repeated) problems.push(`Referência repetida na planilha (linha ${repeated}).`);
      else seenReferences.set(key(reference), line);
    }
    if (!existing && !raw.shortDescription) problems.push("Informe a descrição curta.");
    if ((raw.shortDescription?.length ?? 0) > 512) problems.push("A descrição curta pode ter no máximo 512 caracteres.");
    if ((raw.fullDescription?.length ?? 0) > 2000) problems.push("A descrição completa pode ter no máximo 2.000 caracteres.");
    if ((raw.supplierName?.length ?? 0) > 240) problems.push("O fornecedor pode ter no máximo 240 caracteres.");
    const barcode = raw.barcode ? normalizeBarcode(raw.barcode) : undefined;
    if (barcode) {
      const barcodeError = barcodeProblem(barcode);
      if (barcodeError) problems.push(barcodeError);
      if (/e\+/i.test(barcode)) problems.push("Código de barras virou notação científica no Excel. Formate a coluna como texto e digite de novo.");
      const repeated = seenBarcodes.get(barcode);
      if (repeated) problems.push(`Código de barras repetido na planilha (linha ${repeated}).`);
      else seenBarcodes.set(barcode, line);
      const owner = byBarcode.get(barcode);
      if (owner && owner.id !== existing?.id) problems.push(`Código de barras já está no produto "${owner.shortDescription}".`);
    }
    const unit = raw.unit?.toUpperCase();
    if (unit && isNumericUnit(unit)) problems.push(NUMERIC_UNIT_MESSAGE);
    if (unit && unit.length > 16) problems.push("A unidade pode ter no máximo 16 caracteres.");
    const money = (field: ImportKey, label: string) => {
      const value = parseImportNumber(raw[field] ?? "");
      if (value === undefined) return undefined;
      if (Number.isNaN(value) || value < 0 || value > 99_999_999) problems.push(`${label} inválido: ${raw[field]}.`);
      else if (!hasCents(value)) problems.push(`${label}: use no máximo 2 casas decimais.`);
      return Number.isNaN(value) ? undefined : hasCents(value) ? toCents(value) : value;
    };
    const unitPrice = money("unitPrice", "Valor de venda");
    const costPrice = context.canSeeCost ? money("costPrice", "Preço de custo") : undefined;
    const initialStock = context.canStock && !existing ? money("initialStock", "Quantidade em estoque") : undefined;
    if (initialStock !== undefined && initialStock > 99_999) problems.push("Quantidade em estoque acima do limite de 99.999.");
    if (raw.initialStock && existing) warnings.push("Produto já cadastrado: a quantidade da planilha é ignorada e o estoque não muda.");
    else if (raw.initialStock && !context.canStock) warnings.push("Seu perfil não lança estoque: a quantidade da planilha é ignorada.");
    if (!existing && !raw.unitPrice) warnings.push("Sem valor de venda: entra como R$ 0,00.");
    const reorderPoint = money("reorderPoint", "Ponto de reposição");
    const warranty = parseImportNumber(raw.warrantyMonths ?? "");
    if (warranty !== undefined && (Number.isNaN(warranty) || !Number.isInteger(warranty) || warranty < 0 || warranty > 120)) problems.push("Garantia: informe de 0 a 120 meses.");
    const activeText = key(raw.active ?? "");
    const active = !activeText ? undefined : ["sim", "s", "ativo", "true", "1"].includes(activeText) ? true : ["nao", "n", "inativo", "false", "0"].includes(activeText) ? false : null;
    if (active === null) problems.push("Ativo: use Sim ou Não.");
    parsed.push({
      line,
      raw,
      photo: raw.photo ?? null,
      existing: existing ? { id: existing.id, shortDescription: existing.shortDescription } : null,
      problems,
      warnings,
      data: {
        line,
        reference,
        shortDescription: raw.shortDescription,
        fullDescription: raw.fullDescription,
        barcode,
        unit,
        supplierName: raw.supplierName,
        unitPrice,
        costPrice,
        initialStock,
        reorderPoint,
        warrantyMonths: warranty,
        active: active ?? undefined,
      },
    });
  }
  return { error: null, rows: parsed };
}

// Fornecedores da planilha que não estão cadastrados (sem repetir o nome).
export function unknownSuppliers(rows: ImportRow[], suppliers: string[]) {
  const known = new Set(suppliers.map(key));
  const found = new Map<string, { name: string; lines: number[] }>();
  for (const row of rows) {
    const name = row.data.supplierName?.trim();
    if (!name || known.has(key(name))) continue;
    const entry = found.get(key(name)) ?? { name, lines: [] };
    entry.lines.push(row.line);
    found.set(key(name), entry);
  }
  return Array.from(found.values());
}

export const supplierKey = key;

// Fotos citadas sem arquivo e arquivos que nenhuma linha usa. Compara só o nome,
// sem pasta e sem diferenciar maiúsculas.
export const photoKey = (name: string) => key(name.split(/[\\/]/).pop() ?? name);
export function photoReport(rows: ImportRow[], fileNames: string[]) {
  const files = new Set(fileNames.map(photoKey));
  const cited = new Set(rows.flatMap((row) => (row.photo ? [photoKey(row.photo)] : [])));
  return {
    missing: rows.filter((row) => row.photo && !files.has(photoKey(row.photo))).map((row) => ({ line: row.line, photo: row.photo! })),
    unused: fileNames.filter((name) => !cited.has(photoKey(name))),
  };
}
