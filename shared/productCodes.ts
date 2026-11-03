export function nextProductCode(codes: Array<string | null | undefined>) {
  const highest = codes.reduce((current, code) => {
    const value = Number(code);
    return Number.isInteger(value) && value > current ? value : current;
  }, 0);
  return String(highest + 1);
}

// Referência: obrigatória e única, com letras, números e símbolos
// (ex.: "LM-100/PT", "Ref. 2.045#B"). O código numérico (#12) continua
// sendo criado pelo sistema.
export const REFERENCE_MAX = 64;
export const BARCODE_MAX = 64;

export const normalizeReference = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");

export function referenceProblem(value: string | null | undefined): string | null {
  const reference = normalizeReference(value);
  if (!reference) return "Informe a referência do produto.";
  if (reference.length > REFERENCE_MAX) return `A referência pode ter no máximo ${REFERENCE_MAX} caracteres.`;
  // Quebras de linha e tabulações já viraram espaço; outros caracteres de
  // controle (colados de planilhas) atrapalham a busca e o PDF.
  if (/[\u0000-\u001f\u007f]/.test(reference)) return "A referência não pode ter quebras de linha ou caracteres especiais invisíveis.";
  return null;
}

// Código de barras: opcional. EAN/UPC são só números; Code 128 e Code 39
// também aceitam letras e alguns símbolos. Espaços são removidos.
export const normalizeBarcode = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "");

export function barcodeProblem(value: string | null | undefined): string | null {
  const barcode = normalizeBarcode(value);
  if (!barcode) return null;
  if (barcode.length > BARCODE_MAX) return `O código de barras pode ter no máximo ${BARCODE_MAX} caracteres.`;
  if (!/^[\x21-\x7e]+$/.test(barcode)) return "O código de barras só aceita letras sem acento, números e símbolos.";
  return null;
}

// Sem acento e em minúsculas: "Luminária" acha "luminaria".
export const foldText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

const slug = (value: string) => foldText(value).toUpperCase().replace(/[^A-Z0-9.,/+#]+/g, "");

// Referência sugerida para uma variação: "LM100" + Preto, 3000K → "LM100-PRETO-3000K".
export function suggestVariantReference(rootReference: string, values: Array<string | null | undefined>) {
  const parts = values.map((value) => slug(value ?? "")).filter(Boolean);
  return [normalizeReference(rootReference), ...parts].join("-").slice(0, REFERENCE_MAX);
}

// Garante uma referência que ainda não existe: "X", "X-2", "X-3"...
export function uniqueReference(wanted: string, taken: Iterable<string | null | undefined>) {
  const used = new Set(Array.from(taken, (value) => foldText(value ?? "")));
  if (!used.has(foldText(wanted))) return wanted;
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = wanted.slice(0, REFERENCE_MAX - tail.length) + tail;
    if (!used.has(foldText(candidate))) return candidate;
  }
}

export type SearchableProduct = {
  code: string;
  reference?: string | null;
  shortDescription: string;
  modelName?: string | null;
  supplierName?: string | null;
  barcode?: string | null;
};

// Busca de produtos em todo o sistema: referência, descrição, código de
// barras, código interno e fornecedor. Cada palavra digitada precisa
// aparecer, em qualquer ordem ("pendente preto" acha "Pendente Arco — Preto").
export function matchesProductSearch(product: SearchableProduct, query: string) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = foldText([product.reference, product.code, `#${product.code}`, product.shortDescription, product.modelName, product.supplierName, product.barcode].filter(Boolean).join(" "));
  return words.every((word) => text.includes(word));
}

// Leitura exata (leitor USB ou câmera): código de barras ou referência.
export function findProductByScan<T extends SearchableProduct>(items: T[], value: string) {
  const wanted = foldText(value.trim());
  if (!wanted) return undefined;
  return items.find((item) => item.barcode && foldText(item.barcode) === wanted) ?? items.find((item) => item.reference && foldText(item.reference) === wanted);
}
