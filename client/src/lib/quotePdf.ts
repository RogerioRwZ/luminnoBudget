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
  rooms: Array<{ name: string; items: Array<{ code: string; shortDescription: string; unit: string; quantity: number; unitPrice: number }> }>;
  summary: { rooms: number[]; productsSubtotal: number; discountAmount: number; shipping: number; total: number; pixDiscountAmount: number; pixTotal: number };
  settings?: { companyName: string; tradingName: string; document: string | null; address: string | null; phone: string | null; pixKey: string | null; pixRecipient: string | null };
};

const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const date = (value: Date | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(value) : "—";

export function createQuotePdfDataUrl(input: QuotePdfInput) {
  const pdf = new jsPDF({ format: "a4", unit: "mm" });
  const margin = 15;
  const contentWidth = 180;
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

  pdf.setFillColor(24, 22, 18);
  pdf.rect(0, 0, 210, 35, "F");
  pdf.setTextColor(244, 216, 66);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(input.settings?.tradingName || "Luminno", margin, 17);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(input.settings?.companyName || "Luminno Iluminação", margin, 24);
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
    ensureSpace(16);
    pdf.setFillColor(244, 216, 66);
    pdf.rect(margin, y - 4, contentWidth, 7, "F");
    pdf.setTextColor(20, 20, 20);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(room.name, margin + 3, y);
    y += 6;
    pdf.setFont("helvetica", "normal");
    room.items.forEach((item) => {
      const description = pdf.splitTextToSize(`${item.code} · ${item.shortDescription}`, 100) as string[];
      const height = Math.max(7, description.length * 4.3 + 3);
      ensureSpace(height + 2);
      pdf.setFontSize(8.5);
      pdf.text(description, margin + 3, y);
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
  return pdf.output("datauristring");
}
