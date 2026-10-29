export type CsvColumn<T> = { header: string; value: (row: T) => string | number | boolean | Date | null | undefined };

// Células que começam com estes caracteres são interpretadas como fórmula
// pelo Excel/LibreOffice (CSV injection). Prefixamos com apóstrofo.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function formatCell(value: string | number | boolean | Date | null | undefined) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toLocaleDateString("pt-BR");
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false }) : "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function quote(cell: string) {
  return /[";\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

// CSV no padrão do Excel em português: separador ";" e vírgula decimal.
export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>) {
  const lines = [columns.map((column) => quote(column.header)).join(";")];
  rows.forEach((row) => lines.push(columns.map((column) => quote(formatCell(column.value(row)))).join(";")));
  return lines.join("\r\n");
}

export function csvFileName(prefix: string, now = new Date()) {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}.csv`;
}
