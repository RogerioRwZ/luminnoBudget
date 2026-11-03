export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export type PreparedImage = { dataUrl: string; mimeType: ImageMime; size: number };

const IMAGE_TYPES: ImageMime[] = ["image/jpeg", "image/png", "image/webp"];
export const isSupportedImage = (type: string): type is ImageMime => (IMAGE_TYPES as string[]).includes(type);

function readDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

// Foto de celular tem 3 a 8 MB; para o catálogo, o orçamento e o PDF basta
// algo como 1600 px em WebP (100 a 300 KB). Reduz no próprio aparelho antes de
// enviar, poupando o disco do servidor e a internet de quem usa. Se não der
// para reduzir (navegador antigo, imagem já pequena), envia o original.
export async function prepareImage(file: File, maxSide = 1600): Promise<PreparedImage> {
  const original = async (): Promise<PreparedImage> => ({ dataUrl: await readDataUrl(file), mimeType: file.type as ImageMime, size: file.size });
  if (!isSupportedImage(file.type) || typeof document === "undefined") return original();
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return original();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // WebP mantém a transparência dos logotipos; sem WebP, JPEG só para fotos.
    let blob = await toBlob(canvas, "image/webp", 0.82);
    if (blob?.type !== "image/webp") blob = file.type === "image/png" ? null : await toBlob(canvas, "image/jpeg", 0.85);
    if (!blob || blob.size >= file.size) return original();
    return { dataUrl: await readDataUrl(blob), mimeType: blob.type as ImageMime, size: blob.size };
  } catch {
    return original();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const renameForType = (fileName: string, mimeType: ImageMime) =>
  fileName.replace(/\.[^.]+$/, "") + (mimeType === "image/webp" ? ".webp" : mimeType === "image/png" ? ".png" : ".jpg");
