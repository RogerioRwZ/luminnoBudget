import { cleanUnit } from "@shared/units";
import { buildPixPayload } from "@shared/pix";
import { quotePdfFileName, sanitizePdfSnapshot } from "@shared/quoteFileName";
import { pixQrDataUrl } from "./pixQr";
import { jsPDF } from "jspdf";
import { entryOfferValues, type EntryOffer } from "@shared/paymentPlan";

export type QuotePdfInput = {
  quoteNumber: number;
  status?: "draft" | "open" | "approved" | "lost";
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
  entryOffer?: EntryOffer | null;
  notes: string;
  rooms: Array<{ name: string; items: Array<{ code: string; shortDescription: string; imageUrl?: string | null; unit: string; quantity: number; unitPrice: number }> }>;
  summary: { rooms: number[]; productsSubtotal: number; discountAmount: number; shipping: number; total: number; pixDiscountAmount: number; pixTotal: number; installmentValue?: number };
  settings?: { companyName: string; tradingName: string; logoUrl?: string | null; document: string | null; address: string | null; phone: string | null; email?: string | null; pixKey: string | null; pixRecipient: string | null; pixCity?: string | null };
  // Momento em que o PDF foi gerado (o histórico remonta com a data original).
  generatedAt?: Date;
};

// jsPDF não desenha o espaço não separável que o Intl usa em "R$ 1,00".
const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value).replace(/\u00a0/g, " ");
const date = (value: Date | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(value) : "—";
const time = (value: Date) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(value);
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

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

// No navegador, redesenha a imagem num canvas com fundo branco: converte
// formatos que o jsPDF lê mal (PNG de 16 bits, transparência, WebP) para
// JPEG e reduz fotos grandes, mantendo o PDF leve. Fora do navegador (ou se
// algo falhar) devolve null e a imagem original é usada.
const MAX_IMAGE_PIXELS = 720;
async function normalizeImage(dataUrl: string): Promise<LoadedImage | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = new Image();
    const loaded = new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      window.setTimeout(() => resolve(false), 5000);
    });
    image.src = dataUrl;
    if (!(await loaded) || !image.naturalWidth || !image.naturalHeight) return null;
    const scale = Math.min(1, MAX_IMAGE_PIXELS / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), format: "JPEG", width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
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
    const normalized = await normalizeImage(dataUrl);
    if (normalized) return normalized;
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
// Também devolve quais URLs falharam, para que quem chamar possa avisar a
// pessoa usuária (sem impedir a geração do PDF).
async function preloadImages(input: QuotePdfInput): Promise<{ cache: Map<string, LoadedImage>; failedUrls: string[] }> {
  const urls = new Set<string>();
  if (input.settings?.logoUrl) urls.add(input.settings.logoUrl);
  for (const room of input.rooms) {
    for (const item of room.items) {
      if (item.imageUrl) urls.add(item.imageUrl);
    }
  }
  const cache = new Map<string, LoadedImage>();
  const failedUrls: string[] = [];
  await Promise.all(
    Array.from(urls).map(async url => {
      const loaded = await loadImage(url);
      if (loaded) cache.set(url, loaded);
      else failedUrls.push(url);
    })
  );
  return { cache, failedUrls };
}

// Ajusta uma imagem dentro de um quadrado de `box` mm, preservando a
// proporção original (equivalente ao `object-fit: contain` usado na tela).
function containInBox(image: LoadedImage, box: number) {
  const scale = Math.min(box / image.width, box / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, offsetX: (box - width) / 2, offsetY: (box - height) / 2 };
}


export type QuotePdfResult = { dataUrl: string; failedImageCount: number };

type Rgb = readonly [number, number, number];
// Paleta da identidade visual (mesmas cores da interface).
const COLOR = {
  ink: [28, 27, 25],
  muted: [112, 108, 101],
  subtle: [158, 154, 147],
  line: [229, 226, 219],
  surface: [248, 246, 241],
  dark: [24, 24, 23],
  accent: [244, 216, 66],
  accentSoft: [253, 247, 214],
  green: [14, 120, 80],
  greenSoft: [229, 245, 236],
  white: [255, 255, 255],
} as const satisfies Record<string, Rgb>;

const STATUS = {
  draft: { label: "RASCUNHO", fill: [72, 71, 68] as Rgb, text: COLOR.white },
  open: { label: "EM ABERTO", fill: COLOR.accent, text: COLOR.dark },
  approved: { label: "APROVADO", fill: [22, 140, 92] as Rgb, text: COLOR.white },
  lost: { label: "NÃO APROVADO", fill: [176, 58, 52] as Rgb, text: COLOR.white },
} as const;

const PAGE = { width: 210, height: 297, margin: 14, bottom: 280 } as const;
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const RIGHT = PAGE.width - PAGE.margin;

// QR Code PIX com o valor à vista. Se a chave for inválida para o padrão
// PIX, o PDF sai sem o QR (a chave continua impressa em texto).
async function quotePixQr(input: QuotePdfInput) {
  const settings = input.settings;
  if (!settings?.pixKey || !(input.summary.pixTotal > 0)) return null;
  try {
    const payload = buildPixPayload({ key: settings.pixKey, name: settings.pixRecipient || settings.companyName, city: settings.pixCity || "BRASIL", amount: input.summary.pixTotal, txid: `ORC${input.quoteNumber}`, description: `Orcamento ${input.quoteNumber}` });
    return { payload, image: await pixQrDataUrl(payload, 360) };
  } catch {
    return null;
  }
}

function daysUntil(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

async function buildQuotePdf(input: QuotePdfInput) {
  const [{ cache: images, failedUrls }, pixQr] = await Promise.all([preloadImages(input), quotePixQr(input)]);
  const settings = input.settings;
  const brand = settings?.tradingName || "Luminno";
  const company = settings?.companyName || "Luminno Iluminação";
  const clientLabel = input.clientName || "Cliente não informado";
  const pdf = new jsPDF({ format: "a4", unit: "mm", compress: true });
  pdf.setProperties({
    title: quotePdfFileName(input).replace(/\.pdf$/, ""),
    subject: `Proposta comercial emitida em ${date(input.issueDate)}`,
    author: brand,
    creator: "Luminno Orçamentos",
  });
  pdf.setLineHeightFactor(1.3);

  const fill = (color: Rgb) => pdf.setFillColor(color[0], color[1], color[2]);
  const stroke = (color: Rgb) => pdf.setDrawColor(color[0], color[1], color[2]);
  const ink = (color: Rgb) => pdf.setTextColor(color[0], color[1], color[2]);
  const font = (size: number, style: "normal" | "bold" = "normal", color: Rgb = COLOR.ink) => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    ink(color);
  };
  // Rótulos em caixa alta, pequenos e espaçados (mesmo estilo dos "eyebrows" da interface).
  const eyebrow = (value: string, x: number, top: number, color: Rgb = COLOR.muted, align: "left" | "right" = "left") => {
    font(6.8, "bold", color);
    const label = value.toUpperCase();
    // Com charSpace, o align "right" do jsPDF não desconta o espaçamento.
    const width = pdf.getTextWidth(label) + 0.45 * (label.length - 1);
    pdf.text(label, align === "right" ? x - width : x, top, { charSpace: 0.45 });
  };
  const wrap = (value: string, width: number) => pdf.splitTextToSize(value, width) as string[];
  const lineHeight = (size: number) => size * 0.3528 * 1.3;

  const drawImage = (image: LoadedImage, x: number, top: number, box: number) => {
    const fit = containInBox(image, box);
    pdf.addImage(image.dataUrl, image.format, x + fit.offsetX, top + fit.offsetY, fit.width, fit.height, undefined, "FAST");
  };

  const logo = settings?.logoUrl ? images.get(settings.logoUrl) : undefined;
  const brandMark = (x: number, top: number, size: number) => {
    if (logo) {
      fill(COLOR.white);
      pdf.roundedRect(x, top, size, size, 2.5, 2.5, "F");
      drawImage(logo, x + 2, top + 2, size - 4);
      return;
    }
    fill(COLOR.accent);
    pdf.roundedRect(x, top, size, size, 2.5, 2.5, "F");
    font(size * 0.9, "bold", COLOR.dark);
    pdf.text(brand.slice(0, 2).toUpperCase(), x + size / 2, top + size / 2 + size * 0.11, { align: "center" });
  };

  // ── Cabeçalho completo (primeira página) ──────────────────────────────
  const status = STATUS[input.status ?? "open"];
  fill(COLOR.dark);
  pdf.rect(0, 0, PAGE.width, 46, "F");
  fill(COLOR.accent);
  pdf.rect(0, 46, PAGE.width, 1.2, "F");
  brandMark(PAGE.margin, 10, 26);
  const brandX = PAGE.margin + 32;
  font(19, "bold", COLOR.accent);
  pdf.text(brand, brandX, 19);
  font(9, "normal", COLOR.white);
  pdf.text(company, brandX, 25);
  const contact = [settings?.document ? `CNPJ ${settings.document}` : "", settings?.phone ?? "", settings?.email ?? ""].filter(Boolean).join("   ·   ");
  font(7.5, "normal", [196, 193, 186]);
  if (contact) pdf.text(contact, brandX, 31, { maxWidth: 104 });
  if (settings?.address) pdf.text(wrap(settings.address, 104)[0]!, brandX, 36);

  eyebrow("Orçamento", RIGHT, 15.5, COLOR.accent, "right");
  font(24, "bold", COLOR.white);
  pdf.text(`Nº ${input.quoteNumber}`, RIGHT, 26, { align: "right" });
  font(6.8, "bold", status.text);
  const pillWidth = pdf.getTextWidth(status.label) + status.label.length * 0.45 + 6;
  fill(status.fill);
  pdf.roundedRect(RIGHT - pillWidth, 30.5, pillWidth, 6, 3, 3, "F");
  ink(status.text);
  pdf.text(status.label, RIGHT - pillWidth / 2, 34.6, { align: "center", charSpace: 0.45 });

  let y = 56;

  // ── Cabeçalho compacto e rodapé (demais páginas) ─────────────────────
  const compactHeader = () => {
    fill(COLOR.dark);
    pdf.rect(0, 0, PAGE.width, 15, "F");
    fill(COLOR.accent);
    pdf.rect(0, 15, PAGE.width, 0.8, "F");
    font(11, "bold", COLOR.accent);
    pdf.text(brand, PAGE.margin, 9.6);
    font(8, "normal", COLOR.white);
    pdf.text(`Orçamento nº ${input.quoteNumber}  ·  ${clientLabel}`, RIGHT, 9.6, { align: "right" });
  };
  let currentRoom: { name: string; index: number } | null = null;
  const newPage = () => {
    pdf.addPage();
    compactHeader();
    y = 25;
    if (currentRoom) {
      roomHeader(currentRoom.name, currentRoom.index, true);
      columnHeader();
    }
  };
  const ensureSpace = (height: number) => {
    if (y + height > PAGE.bottom) newPage();
  };

  // ── Cartões de cliente e proposta ────────────────────────────────────
  const cardWidth = (CONTENT_WIDTH - 6) / 2;
  const clientLines: Array<[string, string]> = [
    ["CPF/CNPJ", input.document],
    ["IE/RG", input.stateRegistration],
    ["Telefone", input.phone],
    ["Endereço", input.address],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
  const validity = input.validUntil ? `${date(input.validUntil)}${(() => { const days = daysUntil(input.issueDate, input.validUntil!); return days > 0 ? `  (${days} dia${days === 1 ? "" : "s"})` : ""; })()}` : "A combinar";
  const itemCount = input.rooms.reduce((sum, room) => sum + room.items.length, 0);
  const proposalLines: Array<[string, string]> = [
    ["Emissão", `${date(input.issueDate)} às ${time(input.issueDate)}`],
    ["Validade", validity],
    ["Profissional", input.professional || "—"],
    ["Escopo", `${itemCount} ${itemCount === 1 ? "item" : "itens"} em ${input.rooms.length} ${input.rooms.length === 1 ? "ambiente" : "ambientes"}`],
  ];
  const detailHeight = (lines: Array<[string, string]>, width: number) => lines.reduce((sum, [, value]) => sum + wrap(value, width).length * 3.9 + 1.1, 0);
  // A largura depende da fonte: o nome sai em negrito 12, não na fonte corrente.
  font(12, "bold");
  const clientNameLines = wrap(clientLabel, cardWidth - 10);
  font(8.3);
  const clientHeight = 13 + clientNameLines.length * 5.6 + (clientLines.length ? detailHeight(clientLines, cardWidth - 32) + 1 : 0);
  const proposalHeight = 11 + detailHeight(proposalLines, cardWidth - 32);
  const cardHeight = Math.max(clientHeight, proposalHeight, 34);
  [0, 1].forEach((index) => {
    fill(COLOR.surface);
    pdf.roundedRect(PAGE.margin + index * (cardWidth + 6), y, cardWidth, cardHeight, 2.5, 2.5, "F");
  });
  const detailRows = (lines: Array<[string, string]>, x: number, top: number, width: number) => {
    let rowY = top;
    lines.forEach(([label, value]) => {
      font(7.4, "normal", COLOR.muted);
      pdf.text(label, x, rowY);
      font(8.3, "normal", COLOR.ink);
      const valueLines = wrap(value, width - 24);
      pdf.text(valueLines, x + 24, rowY);
      rowY += valueLines.length * 3.9 + 1.1;
    });
  };
  eyebrow("Cliente", PAGE.margin + 5, y + 6.5);
  font(12, "bold");
  pdf.text(clientNameLines, PAGE.margin + 5, y + 12.5);
  detailRows(clientLines, PAGE.margin + 5, y + 12.5 + clientNameLines.length * 5.6, cardWidth - 8);
  const proposalX = PAGE.margin + cardWidth + 6 + 5;
  eyebrow("Proposta", proposalX, y + 6.5);
  detailRows(proposalLines, proposalX, y + 12.5, cardWidth - 8);
  y += cardHeight + 6;

  // ── Destaques do investimento ────────────────────────────────────────
  const installments = Math.max(1, Math.floor(input.installments || 1));
  const installmentValue = input.summary.installmentValue ?? input.summary.total / installments;
  const tiles: Array<{ label: string; value: string; note: string; tone: "dark" | "green" | "light" }> = [
    { label: "Investimento total", value: currency(input.summary.total), note: input.summary.discountAmount > 0 ? `com ${currency(input.summary.discountAmount)} de desconto` : "valor final da proposta", tone: "dark" },
  ];
  if (input.summary.pixDiscountAmount > 0) tiles.push({ label: "À vista no PIX", value: currency(input.summary.pixTotal), note: `economia de ${currency(input.summary.pixDiscountAmount)}`, tone: "green" });
  tiles.push(installments > 1
    ? { label: "Parcelado", value: `${installments}x ${currency(installmentValue)}`, note: "sem juros", tone: "light" }
    : { label: "Pagamento", value: "À vista", note: pixQr ? "PIX, cartão ou transferência" : "condições abaixo", tone: "light" });
  const entry = input.entryOffer ? entryOfferValues(input.summary.total, input.entryOffer) : null;
  if (entry) tiles.push({ label: "Entrada + crediário", value: `${entry.installments}x ${currency(entry.installmentValue)}`, note: `entrada de ${currency(entry.entry)}`, tone: "light" });
  const tileWidth = (CONTENT_WIDTH - (tiles.length - 1) * 4) / tiles.length;
  tiles.forEach((tile, index) => {
    const x = PAGE.margin + index * (tileWidth + 4);
    const palette = tile.tone === "dark" ? { bg: COLOR.dark, label: COLOR.accent, value: COLOR.white, note: [196, 193, 186] as Rgb }
      : tile.tone === "green" ? { bg: COLOR.greenSoft, label: COLOR.green, value: COLOR.green, note: COLOR.green }
      : { bg: COLOR.accentSoft, label: [120, 100, 10] as Rgb, value: COLOR.ink, note: COLOR.muted };
    fill(palette.bg);
    pdf.roundedRect(x, y, tileWidth, 21, 2.5, 2.5, "F");
    eyebrow(tile.label, x + 5, y + 6.5, palette.label);
    font(tiles.length > 2 ? 14 : 16, "bold", palette.value);
    pdf.text(tile.value, x + 5, y + 13.8);
    font(7.4, "normal", palette.note);
    pdf.text(tile.note, x + 5, y + 18.2);
  });
  y += 21 + 9;

  // ── Itens por ambiente ───────────────────────────────────────────────
  const withImages = input.rooms.some((room) => room.items.some((item) => item.imageUrl));
  const thumb = 13;
  const col = {
    thumb: PAGE.margin,
    description: withImages ? PAGE.margin + thumb + 4 : PAGE.margin,
    quantity: 136,
    unit: 166,
    total: RIGHT,
  };
  const descriptionWidth = col.quantity - 14 - col.description;
  const columnHeader = () => {
    eyebrow("Produto", col.description, y + 3.2, COLOR.subtle);
    eyebrow("Qtd.", col.quantity, y + 3.2, COLOR.subtle, "right");
    eyebrow("Unitário", col.unit, y + 3.2, COLOR.subtle, "right");
    eyebrow("Total", col.total, y + 3.2, COLOR.subtle, "right");
    stroke(COLOR.line);
    pdf.setLineWidth(0.3);
    pdf.line(PAGE.margin, y + 5.3, RIGHT, y + 5.3);
    y += 7.5;
  };
  const roomHeader = (name: string, index: number, continued = false) => {
    fill(COLOR.accentSoft);
    pdf.roundedRect(PAGE.margin, y, CONTENT_WIDTH, 9, 1.8, 1.8, "F");
    fill(COLOR.accent);
    pdf.roundedRect(PAGE.margin, y, 2.2, 9, 1.1, 1.1, "F");
    font(9.5, "bold");
    const label = `${name || "Ambiente"}${continued ? "  (continuação)" : ""}`;
    pdf.text(label, PAGE.margin + 6, y + 6);
    const room = input.rooms[index]!;
    const count = `${room.items.length} ${room.items.length === 1 ? "item" : "itens"}`;
    font(8, "normal", COLOR.muted);
    const subtotal = currency(input.summary.rooms[index] ?? 0);
    pdf.setFont("helvetica", "bold");
    const subtotalWidth = pdf.getTextWidth(subtotal);
    font(9.5, "bold");
    pdf.text(subtotal, RIGHT - 4, y + 6, { align: "right" });
    font(8, "normal", COLOR.muted);
    pdf.text(count, RIGHT - 4 - subtotalWidth - 9, y + 6, { align: "right" });
    y += 12;
  };

  pdfSection("Itens da proposta", `${input.rooms.length} ${input.rooms.length === 1 ? "ambiente" : "ambientes"} · ${itemCount} ${itemCount === 1 ? "item" : "itens"}`);
  input.rooms.forEach((room, roomIndex) => {
    currentRoom = null;
    // Cabeçalho do ambiente nunca fica sozinho no fim da página.
    ensureSpace(12 + 7.5 + (room.items.length ? 18 : 6));
    roomHeader(room.name, roomIndex);
    currentRoom = { name: room.name, index: roomIndex };
    columnHeader();
    if (!room.items.length) {
      font(8.3, "normal", COLOR.muted);
      pdf.text("Nenhum item neste ambiente.", col.description, y + 3);
      y += 8;
    }
    room.items.forEach((item, itemIndex) => {
      font(9, "bold");
      const description = wrap(item.shortDescription, descriptionWidth);
      const textHeight = description.length * lineHeight(9) + 1.6;
      const rowHeight = Math.max(withImages ? thumb + 3 : 0, textHeight + 3);
      ensureSpace(rowHeight + 1);
      if (itemIndex % 2 === 1) {
        fill([251, 250, 247]);
        pdf.rect(PAGE.margin, y - 1.5, CONTENT_WIDTH, rowHeight, "F");
      }
      if (withImages) {
        const image = item.imageUrl ? images.get(item.imageUrl) : undefined;
        fill(image ? COLOR.white : COLOR.surface);
        stroke(COLOR.line);
        pdf.setLineWidth(0.25);
        pdf.roundedRect(col.thumb, y, thumb, thumb, 1.6, 1.6, image ? "FD" : "F");
        if (image) drawImage(image, col.thumb + 1, y + 1, thumb - 2);
      }
      const textTop = y + 3.6;
      font(9, "bold");
      pdf.text(description, col.description, textTop);
      font(8.6, "normal");
      pdf.text(`${quantity(item.quantity)} ${cleanUnit(item.unit)}`, col.quantity, textTop, { align: "right" });
      pdf.text(currency(item.unitPrice), col.unit, textTop, { align: "right" });
      font(9, "bold");
      pdf.text(currency(item.quantity * item.unitPrice), col.total, textTop, { align: "right" });
      y += rowHeight;
      stroke(COLOR.line);
      pdf.setLineWidth(0.2);
      pdf.line(PAGE.margin, y - 1.5, RIGHT, y - 1.5);
    });
    currentRoom = null;
    y += 5;
  });

  // ── Totais e pagamento ───────────────────────────────────────────────
  const discountLabel = input.summary.discountAmount > 0
    ? `Desconto${input.discountMode === "percentage" ? ` (${quantity(input.discountValue)}%)` : ""}`
    : "";
  const totalRows: Array<[string, string]> = [["Produtos e serviços", currency(input.summary.productsSubtotal)]];
  if (discountLabel) totalRows.push([discountLabel, `- ${currency(input.summary.discountAmount)}`]);
  if (input.summary.shipping > 0) totalRows.push(["Frete", currency(input.summary.shipping)]);
  const paymentLines = [
    installments > 1 ? `Parcelado em até ${installments}x de ${currency(installmentValue)} sem juros.` : "Pagamento à vista.",
    input.summary.pixDiscountAmount > 0 ? `À vista no PIX: ${currency(input.summary.pixTotal)}.` : "",
    entry ? `Entrada de ${currency(entry.entry)} + ${entry.installments}x de ${currency(entry.installmentValue)} no crediário próprio.` : "",
    settings?.pixKey ? `Chave PIX: ${settings.pixKey}${settings.pixRecipient ? ` (${settings.pixRecipient})` : ""}` : "",
  ].filter(Boolean);
  const totalsHeight = 8 + totalRows.length * 6 + 11.5 + (input.summary.pixDiscountAmount > 0 ? 6 : 0) + (installments > 1 ? 4 : 0) + (entry ? 4 : 0) + 1;
  font(8.6);
  const paymentWrapped = paymentLines.flatMap((value) => wrap(value, CONTENT_WIDTH - 74 - 6 - 10));
  const paymentHeight = pixQr ? 52 : 19 + paymentWrapped.length * 4.5;
  ensureSpace(Math.max(totalsHeight, paymentHeight) + 14);
  pdfSection("Resumo financeiro");
  const blockTop = y;
  const totalsWidth = 74;
  const totalsX = RIGHT - totalsWidth;
  fill(COLOR.surface);
  pdf.roundedRect(totalsX, blockTop, totalsWidth, totalsHeight, 2.5, 2.5, "F");
  let rowY = blockTop + 8;
  totalRows.forEach(([label, value]) => {
    font(8.3, "normal", COLOR.muted);
    pdf.text(label, totalsX + 5, rowY);
    font(8.6, "normal", label.startsWith("Desconto") ? COLOR.green : COLOR.ink);
    pdf.text(value, RIGHT - 5, rowY, { align: "right" });
    rowY += 6;
  });
  stroke(COLOR.line);
  pdf.setLineWidth(0.3);
  pdf.line(totalsX + 5, rowY - 2.5, RIGHT - 5, rowY - 2.5);
  eyebrow("Total", totalsX + 5, rowY + 3.5);
  font(15, "bold");
  pdf.text(currency(input.summary.total), RIGHT - 5, rowY + 5, { align: "right" });
  rowY += 11.5;
  if (input.summary.pixDiscountAmount > 0) {
    font(8.3, "bold", COLOR.green);
    pdf.text("À vista no PIX", totalsX + 5, rowY);
    pdf.text(currency(input.summary.pixTotal), RIGHT - 5, rowY, { align: "right" });
    rowY += 6;
  }
  if (installments > 1) {
    font(7.8, "normal", COLOR.muted);
    pdf.text(`ou ${installments}x de ${currency(installmentValue)} sem juros`, RIGHT - 5, rowY, { align: "right" });
    rowY += 4;
  }
  if (entry) {
    font(7.8, "normal", COLOR.muted);
    pdf.text(`ou entrada de ${currency(entry.entry)} + ${entry.installments}x de ${currency(entry.installmentValue)}`, RIGHT - 5, rowY, { align: "right" });
  }

  const paymentWidth = CONTENT_WIDTH - totalsWidth - 6;
  stroke(COLOR.line);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(PAGE.margin, blockTop, paymentWidth, paymentHeight, 2.5, 2.5, "S");
  if (pixQr) {
    const qrSize = 38;
    fill(COLOR.white);
    pdf.addImage(pixQr.image, "PNG", PAGE.margin + 5, blockTop + 7, qrSize, qrSize);
    const textX = PAGE.margin + 5 + qrSize + 5;
    const textWidth = paymentWidth - qrSize - 15;
    eyebrow("Pague com PIX", textX, blockTop + 8.5, COLOR.green);
    font(13, "bold", COLOR.ink);
    pdf.text(currency(input.summary.pixTotal), textX, blockTop + 15.5);
    font(7.6, "normal", COLOR.muted);
    const pixDetails = [`Chave: ${settings!.pixKey}`, `Favorecido: ${settings!.pixRecipient || company}`].flatMap((value) => wrap(value, textWidth));
    pdf.text(pixDetails, textX, blockTop + 21);
    const copyTop = blockTop + 21 + pixDetails.length * 3.6 + 2.5;
    eyebrow("Copia e cola", textX, copyTop, COLOR.subtle);
    pdf.setFont("courier", "normal");
    pdf.setFontSize(5.6);
    ink(COLOR.muted);
    const payloadLines = wrap(pixQr.payload, textWidth);
    pdf.text(payloadLines.slice(0, 6), textX, copyTop + 3.6, { lineHeightFactor: 1.15 });
    font(7, "normal", COLOR.subtle);
    pdf.text("Aponte a câmera do app do banco para o código.", PAGE.margin + 5, blockTop + paymentHeight - 4);
  } else {
    eyebrow("Formas de pagamento", PAGE.margin + 5, blockTop + 8.5);
    font(8.6, "normal");
    pdf.text(paymentWrapped, PAGE.margin + 5, blockTop + 15);
  }
  y = blockTop + Math.max(totalsHeight, paymentHeight) + 9;

  // ── Observações e condições ──────────────────────────────────────────
  const notes = input.notes.split(/\r?\n/).map((note) => note.trim()).filter(Boolean);
  if (notes.length) {
    font(8.6);
    const noteLines = notes.map((note) => wrap(note, CONTENT_WIDTH - 6));
    const notesHeight = noteLines.reduce((sum, lines) => sum + lines.length * 4.1 + 1.4, 0);
    ensureSpace(Math.min(notesHeight, 40) + 12);
    pdfSection("Observações e condições");
    noteLines.forEach((lines) => {
      ensureSpace(lines.length * 4.1 + 1.4);
      fill(COLOR.accent);
      pdf.circle(PAGE.margin + 1.2, y - 1.1, 0.8, "F");
      font(8.6, "normal");
      pdf.text(lines, PAGE.margin + 5, y);
      y += lines.length * 4.1 + 1.4;
    });
    y += 5;
  }

  // ── Aceite ───────────────────────────────────────────────────────────
  ensureSpace(31);
  pdfSection("Aceite da proposta");
  font(8, "normal", COLOR.muted);
  const acceptance = wrap("Ao assinar, o cliente declara estar de acordo com os itens, valores e condições desta proposta.", CONTENT_WIDTH);
  pdf.text(acceptance, PAGE.margin, y);
  y += acceptance.length * 3.8 + 10;
  stroke(COLOR.subtle);
  pdf.setLineWidth(0.3);
  const signatureWidth = 108;
  pdf.line(PAGE.margin, y, PAGE.margin + signatureWidth, y);
  pdf.line(PAGE.margin + signatureWidth + 12, y, RIGHT, y);
  font(7.4, "normal", COLOR.muted);
  pdf.text(input.clientName ? `${input.clientName}` : "Assinatura do cliente", PAGE.margin, y + 4);
  pdf.text("Data", PAGE.margin + signatureWidth + 12, y + 4);

  // ── Rodapé em todas as páginas ───────────────────────────────────────
  const generatedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(input.generatedAt ?? new Date());
  const footerContact = [company, settings?.phone, settings?.email].filter(Boolean).join("  ·  ");
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    stroke(COLOR.line);
    pdf.setLineWidth(0.3);
    pdf.line(PAGE.margin, 284, RIGHT, 284);
    font(7, "normal", COLOR.muted);
    pdf.text(footerContact, PAGE.margin, 288.5);
    pdf.text(`Página ${page} de ${pageCount}`, RIGHT, 288.5, { align: "right" });
    font(6.4, "normal", COLOR.subtle);
    pdf.text(`Orçamento nº ${input.quoteNumber}  ·  gerado em ${generatedAt}`, PAGE.margin, 292.5);
  }
  return { pdf, failedImageCount: failedUrls.length };

  // Título de seção com linha fina de apoio.
  function pdfSection(title: string, aside?: string) {
    ensureSpace(14);
    font(11, "bold");
    pdf.text(title, PAGE.margin, y + 4);
    if (aside) {
      font(8, "normal", COLOR.muted);
      pdf.text(aside, RIGHT, y + 4, { align: "right" });
    }
    stroke(COLOR.line);
    pdf.setLineWidth(0.3);
    pdf.line(PAGE.margin, y + 7, RIGHT, y + 7);
    y += 12;
  }
}

export async function createQuotePdfDataUrl(input: QuotePdfInput): Promise<QuotePdfResult> {
  const { pdf, failedImageCount } = await buildQuotePdf(input);
  return { dataUrl: pdf.output("datauristring"), failedImageCount };
}

// Mesmo documento, como Blob, para pré-visualizar e imprimir no navegador.
export async function createQuotePdfBlob(input: QuotePdfInput) {
  const { pdf, failedImageCount } = await buildQuotePdf(input);
  return { blob: pdf.output("blob"), failedImageCount };
}

// Histórico de PDFs: o servidor guarda só os dados usados no documento (alguns
// KB) e o PDF é montado de novo no navegador ao baixar, igual ao original.
export function toPdfSnapshot(input: QuotePdfInput) {
  const pick = <T extends object, K extends keyof T>(source: T | undefined, keys: K[]) =>
    source ? (Object.fromEntries(keys.map(key => [key, source[key]])) as Pick<T, K>) : undefined;
  return {
    quoteNumber: input.quoteNumber, status: input.status, clientName: input.clientName, professional: input.professional,
    document: input.document, stateRegistration: input.stateRegistration, phone: input.phone, address: input.address,
    issueDate: input.issueDate, validUntil: input.validUntil, discountMode: input.discountMode, discountValue: input.discountValue,
    shipping: input.shipping, pixDiscountMode: input.pixDiscountMode, pixDiscountValue: input.pixDiscountValue,
    installments: input.installments, entryOffer: input.entryOffer ?? null, notes: input.notes,
    rooms: input.rooms.map(room => ({ name: room.name, items: room.items.map(item => pick(item, ["code", "shortDescription", "imageUrl", "unit", "quantity", "unitPrice"])!) })),
    summary: input.summary,
    settings: pick(input.settings, ["companyName", "tradingName", "logoUrl", "document", "address", "phone", "email", "pixKey", "pixRecipient", "pixCity"]),
    generatedAt: input.generatedAt ?? new Date(),
  } satisfies QuotePdfInput;
}

export function fromPdfSnapshot(text: string): QuotePdfInput {
  // Também aqui: só imagens do próprio sistema (dados gravados antes da
  // conferência no servidor).
  const value = sanitizePdfSnapshot(JSON.parse(text)) as QuotePdfInput & { issueDate: string; validUntil: string | null; generatedAt?: string };
  return {
    ...value,
    issueDate: new Date(value.issueDate),
    validUntil: value.validUntil ? new Date(value.validUntil) : null,
    generatedAt: value.generatedAt ? new Date(value.generatedAt) : undefined,
  };
}
