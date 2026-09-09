import { jsPDF } from "jspdf";

export type QuotePdfInput = {
  quoteNumber: number;
  clientName: string;
  professional: string;
  document: string;
  stateRegistration: string;
  phone: string;
  address: string;
  issueDate: Date;
  validUntil: Date | null;
  discountMode: "percentage" | "fixed";
  discountValue: number;
  shipping: number;
  pixDiscountMode: "percentage" | "fixed";
  pixDiscountValue: number;
  installments: number;
  notes: string;
  rooms: Array<{ name: string; items: Array<{ code: string; shortDescription: string; imageUrl?: string | null; unit: string; quantity: number; unitPrice: number }> }>;
  summary: { rooms: number[]; productsSubtotal: number; discountAmount: number; shipping: number; total: number; pixDiscountAmount: number; pixTotal: number };
  settings?: { companyName: string; tradingName: string; logoUrl?: string | null; document: string | null; address: string | null; phone: string | null; pixKey: string | null; pixRecipient: string | null };
};

const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const date = (value: Date | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(value) : "—";

type LoadedImage = { dataUrl: string; format: "JPEG" | "PNG" | "WEBP"; width: number; height: number };

function guessMimeType(url: string): string | null {
  const extension = url.split(".").pop()?.toLowerCase().split(/[?#]/)[0];
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

function imageFormatFromMime(mimeType: string): "JPEG" | "PNG" | "WEBP" | null {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "JPEG";
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "image/webp") return "WEBP";
  return null;
}

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]!);
    }
  }
  return btoa(binary);
}

// Busca uma imagem (logotipo ou foto de produto) e a converte para um data URI
// que o jsPDF consegue incorporar diretamente no PDF. Qualquer falha (imagem
// ausente, rede indisponível, formato não suportado) é silenciosamente
// ignorada: a geração do PDF nunca deve travar por causa de uma imagem.
async function loadImage(url: string): Promise<LoadedImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || guessMimeType(url);
    const format = mimeType ? imageFormatFromMime(mimeType) : null;
    if (!format || !mimeType) return null;
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return null;
    const base64 = await arrayBufferToBase64(buffer);
    const dataUrl = `data:${mimeType};base64,${base64}`;
    // jsPDF já sabe interpretar cabeçalhos JPEG/PNG/WEBP para nos dizer as
    // dimensões reais da imagem, o que usamos para preservar a proporção.
    const tempPdf = new jsPDF();
    const properties = tempPdf.getImageProperties(dataUrl);
    if (!properties.width || !properties.height) return null;
    return { dataUrl, format, width: properties.width, height: properties.height };
  } catch {
    return null;
  }
}

// Carrega, em paralelo e sem duplicar requisições repetidas, todas as
// imagens (logotipo + fotos de produto) referenciadas pelo orçamento.
async function preloadImages(input: QuotePdfInput): Promise<Map<string, LoadedImage>> {
  const urls = new Set<string>();
  if (input.settings?.logoUrl) urls.add(input.settings.logoUrl);
  for (const room of input.rooms) {
    for (const item of room.items) {
      if (item.imageUrl) urls.add(item.imageUrl);
    }
  }
  const cache = new Map<string, LoadedImage>();
  await Promise.all(
    Array.from(urls).map(async url => {
      const loaded = await loadImage(url);
      if (loaded) cache.set(url, loaded);
    })
  );
  return cache;
}

// Ajusta uma imagem dentro de um quadrado de `box` mm, preservando a
// proporção original (equivalente ao `object-fit: contain` usado na tela).
function containInBox(image: LoadedImage, box: number) {
  const scale = Math.min(box / image.width, box / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, offsetX: (box - width) / 2, offsetY: (box - height) / 2 };
}

export async function createQuotePdfDataUrl(input: QuotePdfInput): Promise<string> {
  const images = await preloadImages(input);
  const pdf = new jsPDF({ format: "a4", unit: "mm" });
  pdf.setProperties({
    title: `Orçamento nº ${input.quoteNumber} — ${input.clientName || "Cliente"}`,
    subject: `Orçamento gerado em ${date(input.issueDate)}`,
    author: input.settings?.tradingName || input.settings?.companyName || "Luminno",
    creator: "Luminno Orçamentos",
  });
  const margin = 15;
  const contentWidth = 180;
  const thumbBox = 10;
  let y = 15;
  const ensureSpace = (height: number) => {
    if (y + height <= 280) return;
    pdf.addPage();
    y = 15;
  };
  const text = (value: string, x: number, width: number, lineHeight = 5) => {
    const lines = pdf.splitTextToSize(value, width) as string[];
    ensureSpace(lines.length * lineHeight + 2);
    pdf.text(lines, x, y);
    y += lines.length * lineHeight;
  };
  const line = () => { pdf.setDrawColor(206, 206, 206); pdf.line(margin, y, margin + contentWidth, y); y += 5; };
  const drawThumbnail = (imageUrl: string | null | undefined, x: number, top: number) => {
    pdf.setDrawColor(225, 225, 225);
    pdf.rect(x, top, thumbBox, thumbBox);
    const loaded = imageUrl ? images.get(imageUrl) : undefined;
    if (!loaded) return;
    const fit = containInBox(loaded, thumbBox - 1);
    pdf.addImage(
      loaded.dataUrl,
      loaded.format,
      x + 0.5 + fit.offsetX,
      top + 0.5 + fit.offsetY,
      fit.width,
      fit.height
    );
  };

  pdf.setFillColor(24, 22, 18);
  pdf.rect(0, 0, 210, 35, "F");
  const logo = input.settings?.logoUrl ? images.get(input.settings.logoUrl) : undefined;
  const textStartX = logo ? margin + 26 : margin;
  if (logo) {
    const fit = containInBox(logo, 22);
    pdf.addImage(logo.dataUrl, logo.format, margin + fit.offsetX, 6.5 + fit.offsetY, fit.width, fit.height);
  }
  pdf.setTextColor(244, 216, 66);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(input.settings?.tradingName || "Luminno", textStartX, 17);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(input.settings?.companyName || "Luminno Iluminação", textStartX, 24);
  pdf.text(`ORÇAMENTO Nº ${input.quoteNumber}`, 195, 17, { align: "right" });
  pdf.text(`Emissão: ${date(input.issueDate)}`, 195, 24, { align: "right" });
  y = 45;

  pdf.setTextColor(30, 30, 30);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("DADOS DO CLIENTE", margin, y);
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  text(`Cliente: ${input.clientName || "Não informado"}`, margin, contentWidth);
  text(`Profissional responsável: ${input.professional || "Não informado"}`, margin, contentWidth);
  text(`CPF/CNPJ: ${input.document || "—"}    IE/RG: ${input.stateRegistration || "—"}    Telefone: ${input.phone || "—"}`, margin, contentWidth);
  text(`Endereço: ${input.address || "—"}`, margin, contentWidth);
  text(`Validade: ${date(input.validUntil)}`, margin, contentWidth);
  y += 2;
  line();

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("DETALHAMENTO", margin, y);
  y += 7;
  input.rooms.forEach((room, roomIndex) => {
    // Reserva espaço para o cabeçalho do ambiente E ao menos um item, para
    // que o cabeçalho nunca fique "órfão" sozinho no final de uma página.
    ensureSpace(room.items.length ? 16 + thumbBox + 3 : 16);
    pdf.setFillColor(244, 216, 66);
    pdf.rect(margin, y - 4, contentWidth, 7, "F");
    pdf.setTextColor(20, 20, 20);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(room.name, margin + 3, y);
    y += 6;
    pdf.setFont("helvetica", "normal");
    room.items.forEach((item) => {
      const descriptionX = margin + 3 + thumbBox + 3;
      const description = pdf.splitTextToSize(`${item.code} · ${item.shortDescription}`, 100 - thumbBox - 3) as string[];
      const height = Math.max(thumbBox + 3, description.length * 4.3 + 3);
      ensureSpace(height + 2);
      drawThumbnail(item.imageUrl, margin + 3, y - 4);
      pdf.setFontSize(8.5);
      pdf.text(description, descriptionX, y);
      pdf.text(`${item.quantity} ${item.unit}`, 122, y);
      pdf.text(currency(item.unitPrice), 150, y, { align: "right" });
      pdf.text(currency(item.quantity * item.unitPrice), 195, y, { align: "right" });
      y += height;
      pdf.setDrawColor(232, 232, 232);
      pdf.line(margin, y - 2, margin + contentWidth, y - 2);
    });
    ensureSpace(8);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text("Total do ambiente", 135, y);
    pdf.text(currency(input.summary.rooms[roomIndex] ?? 0), 195, y, { align: "right" });
    y += 8;
  });

  ensureSpace(48);
  line();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("TOTAIS", margin, y);
  y += 7;
  const totals = [
    ["Produtos e serviços", input.summary.productsSubtotal],
    [`Desconto (${input.discountMode === "percentage" ? "%" : "R$"})`, -input.summary.discountAmount],
    ["Frete", input.summary.shipping],
    ["TOTAL DO ORÇAMENTO", input.summary.total],
  ] as const;
  totals.forEach(([label, value], index) => {
    pdf.setFont("helvetica", index === totals.length - 1 ? "bold" : "normal");
    pdf.setFontSize(index === totals.length - 1 ? 11 : 9);
    pdf.text(label, 125, y);
    pdf.text(currency(value), 195, y, { align: "right" });
    y += 6;
  });
  if (input.summary.pixDiscountAmount > 0) {
    y += 2;
    text(`Pagamento à vista via PIX: ${currency(input.summary.pixTotal)}`, margin, contentWidth);
  }
  text(`Parcelamento: até ${input.installments}x sem juros.`, margin, contentWidth);
  if (input.settings?.pixKey) text(`Chave PIX: ${input.settings.pixKey}${input.settings.pixRecipient ? ` — ${input.settings.pixRecipient}` : ""}`, margin, contentWidth);
  if (input.notes) text(`Observações: ${input.notes}`, margin, contentWidth);

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setTextColor(110, 110, 110);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(`Documento gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`, margin, 290);
    pdf.text(`Página ${page} de ${pageCount}`, 195, 290, { align: "right" });
  }
  return { dataUrl: pdf.output("datauristring"), failedImageCount: failedUrls.length };
}
