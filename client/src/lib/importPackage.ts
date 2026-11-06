import { photoKey } from "@shared/productImport";
import { listZip, XlsxError, zipEntryData } from "./xlsx";

const MAX_SHEET = 25 * 1024 * 1024;
const MAX_ZIP = 1024 * 1024 * 1024;
const MAX_PHOTOS_TOTAL = 2 * 1024 * 1024 * 1024;

// O tipo vazio faz a foto ser recusada na linha que a usa, com o motivo.
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "", heif: "", gif: "", bmp: "", tif: "", tiff: "" };

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
// Lixo que o Mac e o Excel deixam: não são arquivos de quem montou o .zip.
const isJunk = (path: string) => {
  const name = baseName(path);
  return !name || /(^|[\\/])__MACOSX[\\/]/.test(path) || name.startsWith("._") || name.startsWith("~$") || name.startsWith(".");
};

// Aceita a planilha sozinha ou o .zip com a planilha e as fotos. Os dois são ZIP
// por dentro: quem decide é o conteúdo, não a extensão.
export async function readImportFile(file: File) {
  if (file.size > MAX_ZIP) throw new XlsxError("O arquivo é grande demais (máximo de 1 GB). Divida em mais de um .zip.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries;
  try {
    entries = listZip(bytes);
  } catch {
    throw new XlsxError("Este arquivo não é uma planilha .xlsx nem um .zip válido. No Excel, use Salvar como > Pasta de Trabalho do Excel (.xlsx).");
  }
  if (entries.some((entry) => entry.name === "xl/workbook.xml")) {
    if (bytes.length > MAX_SHEET) throw new XlsxError("A planilha é grande demais (máximo de 25 MB).");
    return { sheet: bytes, photos: [] as File[], duplicates: [] as string[] };
  }
  const files = entries.filter((entry) => !entry.name.endsWith("/") && !isJunk(entry.name));
  if (files.some((entry) => entry.encrypted)) throw new XlsxError("O .zip está protegido por senha. Crie o arquivo sem senha.");
  const sheets = files.filter((entry) => /\.xlsx$/i.test(entry.name));
  if (!sheets.length) throw new XlsxError(files.some((entry) => /\.(xls|csv|ods)$/i.test(entry.name)) ? "A planilha dentro do .zip precisa estar em .xlsx." : "Não achei a planilha .xlsx dentro do .zip.");
  if (sheets.length > 1) throw new XlsxError(`O .zip tem mais de uma planilha (${sheets.map((entry) => baseName(entry.name)).join(", ")}). Deixe só uma.`);
  try {
    const sheet = await zipEntryData(bytes, sheets[0]!, MAX_SHEET);
    const photos: File[] = [];
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    let left = MAX_PHOTOS_TOTAL;
    for (const entry of files) {
      const name = baseName(entry.name);
      const type = IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
      if (type === undefined) continue;
      const data = await zipEntryData(bytes, entry, left);
      left -= data.length;
      if (seen.has(photoKey(name))) duplicates.add(name);
      seen.add(photoKey(name));
      photos.push(new File([data as BlobPart], name, { type }));
    }
    return { sheet, photos, duplicates: Array.from(duplicates) };
  } catch (error) {
    if (error instanceof Error && error.message === "too-big") throw new XlsxError("O conteúdo do .zip é grande demais. Divida em mais de um arquivo.");
    throw new XlsxError("Não foi possível abrir o .zip. Crie o arquivo de novo e tente outra vez.");
  }
}
