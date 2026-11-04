import { plural } from "./plural";

// Comprovante de uma retirada: o que saiu nesta vez e o que ainda falta.
// Vai para o cliente, então não mostra referência nem valores.
type ReceiptDelivery = { id: number; deliveredQuantity: number; deliveredAt: Date | string; responsible: string | null; notes: string | null; reversedAt: Date | string | null };
export type ReceiptLine = {
  quoteNumber: number;
  clientName: string;
  phone: string | null;
  quoteItemId: number;
  roomName: string;
  shortDescription: string;
  unit: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  cancelledQuantity: number;
  pendingQuantity: number;
  deliveries: ReceiptDelivery[];
};
export type DeliveryReceipt = {
  receiptNumber: number;
  quoteNumber: number;
  clientName: string;
  phone: string | null;
  deliveredAt: Date;
  responsible: string | null;
  notes: string[];
  items: Array<{ description: string; roomName: string; unit: string; quantity: number }>;
  pending: Array<{ description: string; roomName: string; unit: string; ordered: number; delivered: number; cancelled: number; pending: number }>;
};

// Lançamentos do mesmo momento e responsável são a mesma retirada: é como o
// "Retirar tudo" e a conferência gravam vários itens de uma vez.
const sameBatch = (first: ReceiptDelivery, second: ReceiptDelivery) =>
  new Date(first.deliveredAt).getTime() === new Date(second.deliveredAt).getTime() && (first.responsible ?? "") === (second.responsible ?? "");

export function buildReceipt(lines: ReceiptLine[], deliveryId: number): DeliveryReceipt | null {
  const target = lines.flatMap((line) => line.deliveries).find((delivery) => delivery.id === deliveryId);
  if (!target || target.reversedAt) return null;
  const batch = lines.flatMap((line) => line.deliveries.filter((delivery) => !delivery.reversedAt && sameBatch(delivery, target)).map((delivery) => ({ line, delivery })));
  return {
    receiptNumber: Math.min(...batch.map(({ delivery }) => delivery.id)),
    quoteNumber: lines[0]!.quoteNumber,
    clientName: lines[0]!.clientName,
    phone: lines[0]!.phone,
    deliveredAt: new Date(target.deliveredAt),
    responsible: target.responsible,
    notes: Array.from(new Set(batch.flatMap(({ delivery }) => (delivery.notes ? [delivery.notes] : [])))),
    items: batch.map(({ line, delivery }) => ({ description: line.shortDescription, roomName: line.roomName, unit: line.unit, quantity: delivery.deliveredQuantity })),
    pending: lines.filter((line) => line.pendingQuantity > 0).map((line) => ({ description: line.shortDescription, roomName: line.roomName, unit: line.unit, ordered: line.orderedQuantity, delivered: line.deliveredQuantity, cancelled: line.cancelledQuantity, pending: line.pendingQuantity })),
  };
}

const escape = (value: string | number | null | undefined) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const dateTime = (value: Date) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(value);

// Mesma identidade da lista de separação, pensada para impressão.
const STYLE = `
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1c1b19;margin:0;font-size:11px;background:#fff}
.sheet{max-width:186mm;margin:0 auto;padding:6mm 0}
header{background:#181817;color:#fff;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #f4d842}
.brand b{display:block;color:#f4d842;font-size:20px;letter-spacing:-.4px}
.brand span{color:#c4c1ba;font-size:10px}
.doc{text-align:right}
.eyebrow{font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.doc .eyebrow{color:#f4d842}
.doc strong{display:block;font-size:18px;margin-top:2px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.card{background:#f8f6f1;border-radius:8px;padding:9px 11px}
.card .eyebrow{color:#706c65}
.card p{margin:4px 0 0;font-size:12px;font-weight:600;overflow-wrap:anywhere}
.card .blank{height:16px;border-bottom:1px solid #9e9a93}
h2{font-size:13px;margin:16px 0 4px}
table{width:100%;border-collapse:collapse}
thead th{font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9e9a93;text-align:left;padding:6px 8px;border-bottom:1px solid #e5e2db}
tbody td{padding:8px;border-bottom:1px solid #eeebe5;vertical-align:top}
tr{break-inside:avoid;page-break-inside:avoid}
.n{text-align:right;white-space:nowrap}
.qty{font-size:13px;font-weight:800;text-align:right;white-space:nowrap}
.rooms{color:#706c65;font-size:10px}
.note{margin:10px 0 0;padding:8px 11px;border-radius:8px;background:#f8f6f1;font-size:10px;color:#4a4740}
.done{margin:14px 0 0;padding:9px 11px;border-radius:8px;background:#e8f5ec;font-size:11px;font-weight:600;color:#1d6b3a}
.declare{margin:18px 0 0;line-height:1.45}
.sign{display:grid;grid-template-columns:2fr 1fr;gap:18px;margin-top:38px}
.sign div{border-top:1px solid #9e9a93;padding-top:4px;font-size:9px;color:#706c65}
footer{margin-top:18px;border-top:1px solid #e5e2db;padding-top:6px;display:flex;justify-content:space-between;gap:12px;color:#9e9a93;font-size:9px}
`;

type ReceiptDocument = { receipt: DeliveryReceipt; issuedAt: Date; issuedBy?: string | null; brand?: { tradingName?: string | null; companyName?: string | null; phone?: string | null } | null };

export function buildReceiptDocument({ receipt, issuedAt, issuedBy, brand }: ReceiptDocument) {
  const tradingName = brand?.tradingName || "Luminno";
  const items = receipt.items.map((item) => `<tr><td><b>${escape(item.description)}</b></td><td class="rooms">${escape(item.roomName)}</td><td class="qty">${escape(`${quantity(item.quantity)} ${item.unit}`)}</td></tr>`).join("");
  const pending = receipt.pending.map((item) => `<tr><td>${escape(item.description)}</td><td class="rooms">${escape(item.roomName)}</td><td class="n">${escape(quantity(item.ordered))}</td><td class="n">${escape(quantity(item.delivered))}</td>${receipt.pending.some((row) => row.cancelled > 0) ? `<td class="n">${escape(quantity(item.cancelled))}</td>` : ""}<td class="qty">${escape(`${quantity(item.pending)} ${item.unit}`)}</td></tr>`).join("");
  const hasCancelled = receipt.pending.some((row) => row.cancelled > 0);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Comprovante de retirada nº ${escape(receipt.receiptNumber)} — Orçamento #${escape(receipt.quoteNumber)}</title><style>${STYLE}</style></head><body><div class="sheet">`
    + `<header><div class="brand"><b>${escape(tradingName)}</b><span>${escape(brand?.companyName ?? "")}${brand?.phone ? ` · ${escape(brand.phone)}` : ""}</span></div><div class="doc"><div class="eyebrow">Comprovante de retirada nº ${escape(receipt.receiptNumber)}</div><strong>Orçamento #${escape(receipt.quoteNumber)}</strong></div></header>`
    + `<section class="cards"><div class="card"><div class="eyebrow">Cliente</div><p>${escape(receipt.clientName || "Não informado")}</p>${receipt.phone ? `<span class="rooms">${escape(receipt.phone)}</span>` : ""}</div><div class="card"><div class="eyebrow">Data da retirada</div><p>${escape(dateTime(receipt.deliveredAt))}</p></div><div class="card"><div class="eyebrow">Retirado por</div>${receipt.responsible ? `<p>${escape(receipt.responsible)}</p>` : `<p class="blank"></p>`}</div></section>`
    + `<h2>Entregue nesta retirada</h2><table><thead><tr><th>Produto</th><th>Ambiente</th><th style="text-align:right">Quantidade</th></tr></thead><tbody>${items}</tbody></table>`
    + receipt.notes.map((note) => `<p class="note">${escape(note)}</p>`).join("")
    + (receipt.pending.length
      ? `<h2>Ainda a retirar</h2><table><thead><tr><th>Produto</th><th>Ambiente</th><th style="text-align:right">Pedido</th><th style="text-align:right">Entregue</th>${hasCancelled ? `<th style="text-align:right">Cancelado</th>` : ""}<th style="text-align:right">Falta</th></tr></thead><tbody>${pending}</tbody></table>`
      : `<p class="done">Nada a retirar: pedido concluído.</p>`)
    + `<p class="declare">Declaro ter recebido os produtos listados em "Entregue nesta retirada", na quantidade indicada.</p>`
    + `<section class="sign"><div>Assinatura de quem retirou</div><div>Documento (RG ou CPF)</div></section>`
    + `<footer><span>Situação do pedido em ${escape(dateTime(issuedAt))}${issuedBy ? `, emitido por ${escape(issuedBy)}` : ""}. ${escape(plural(receipt.items.length, "item entregue", "itens entregues"))}.</span><span>Documento operacional — não é comprovante fiscal.</span></footer>`
    + `</div></body></html>`;
}
