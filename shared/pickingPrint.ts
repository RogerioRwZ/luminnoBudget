import { totalsByUnit, type PickingItem } from "./picking";
import { plural } from "./plural";

type PickingDocument = {
  quote: { quoteNumber: number; clientName: string; professional: string };
  items: Array<Pick<PickingItem, "key" | "code" | "shortDescription" | "fullDescription" | "unit" | "quantity" | "rooms"> & Partial<Pick<PickingItem, "deliveredQuantity" | "orderedQuantity">>>;
  issuedAt: string;
  brand?: { tradingName?: string | null; companyName?: string | null; phone?: string | null } | null;
};
type PrintWindow = { document: { write: (html: string) => void; close: () => void } };
const escape = (value: string | number | null | undefined) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

// Mesma identidade visual do PDF do orçamento: faixa escura com a marca em
// amarelo, cartões de informação e tabela limpa, pensada para impressão.
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
.doc strong{display:block;font-size:22px;margin-top:2px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.card{background:#f8f6f1;border-radius:8px;padding:9px 11px}
.card .eyebrow{color:#706c65}
.card p{margin:4px 0 0;font-size:12px;font-weight:600}
table{width:100%;border-collapse:collapse;margin-top:4px}
thead th{font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9e9a93;text-align:left;padding:6px 8px;border-bottom:1px solid #e5e2db}
tbody td{padding:9px 8px;border-bottom:1px solid #eeebe5;vertical-align:top}
tbody tr:nth-child(even) td{background:#fbfaf7}
tr{break-inside:avoid;page-break-inside:avoid}
.n{color:#9e9a93;width:22px}
.product b{font-size:12px}
.product small{display:block;color:#9e9a93;font-size:9px;margin-top:1px}
.product span{display:block;margin-top:4px;line-height:1.35;color:#4a4740}
.rooms{color:#706c65;font-size:10px}
.qty{font-size:14px;font-weight:800;text-align:right;white-space:nowrap}
.check{width:30px;text-align:center}
.check i{display:inline-block;width:14px;height:14px;border:1.5px solid #1c1b19;border-radius:3px}
.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:34px}
.sign div{border-top:1px solid #9e9a93;padding-top:4px;font-size:9px;color:#706c65}
footer{margin-top:16px;border-top:1px solid #e5e2db;padding-top:6px;display:flex;justify-content:space-between;color:#9e9a93;font-size:9px}
.empty{padding:18px;text-align:center;color:#706c65}
.done{color:#706c65;font-size:10px;text-align:right;white-space:nowrap}
.note{margin:10px 0 0;padding:8px 11px;border-radius:8px;background:#fff8d6;font-size:10px;color:#5c4b00}
`;

export function buildPickingPrintDocument(data: PickingDocument) {
  const tradingName = data.brand?.tradingName || "Luminno";
  const companyName = data.brand?.companyName || "";
  // Só o que falta separar; o que já foi retirado aparece numa coluna à parte.
  const toPick = data.items.filter((item) => item.quantity > 0);
  const deliveredCount = data.items.filter((item) => (item.deliveredQuantity ?? 0) > 0).length;
  const fullyDelivered = data.items.length - toPick.length;
  const partial = deliveredCount > 0;
  const rows = toPick.map((item, index) => `<tr><td class="n">${index + 1}</td><td class="product"><b>${escape(item.shortDescription)}</b><small>Cód. ${escape(item.code)}</small>${item.fullDescription && item.fullDescription !== item.shortDescription ? `<span>${escape(item.fullDescription)}</span>` : ""}</td><td class="rooms">${escape(item.rooms.join(", "))}</td>${partial ? `<td class="done">${item.deliveredQuantity ? escape(`${quantity(item.deliveredQuantity)} de ${quantity(item.orderedQuantity ?? item.quantity + item.deliveredQuantity)}`) : "—"}</td>` : ""}<td class="qty">${escape(`${quantity(item.quantity)} ${item.unit}`)}</td><td class="check"><i></i></td></tr>`).join("");
  const title = partial ? "Separação parcial" : "Lista de separação";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Separação — Orçamento #${escape(data.quote.quoteNumber)}</title><style>${STYLE}</style></head><body><div class="sheet">`
    + `<header><div class="brand"><b>${escape(tradingName)}</b><span>${escape(companyName)}${data.brand?.phone ? ` · ${escape(data.brand.phone)}` : ""}</span></div><div class="doc"><div class="eyebrow">${title}</div><strong>Orçamento #${escape(data.quote.quoteNumber)}</strong></div></header>`
    + `<section class="cards"><div class="card"><div class="eyebrow">Cliente</div><p>${escape(data.quote.clientName || "Não informado")}</p></div><div class="card"><div class="eyebrow">Profissional</div><p>${escape(data.quote.professional || "Não informado")}</p></div><div class="card"><div class="eyebrow">Emitido em</div><p>${escape(data.issuedAt)}</p></div></section>`
    + (partial ? `<p class="note">Parte deste pedido já foi retirada. A lista mostra apenas o que falta separar${fullyDelivered ? `; ${escape(plural(fullyDelivered, "produto já entregue por completo não aparece", "produtos já entregues por completo não aparecem"))}` : ""}.</p>` : "")
    + `<table><thead><tr><th>#</th><th>Produto</th><th>Ambientes</th>${partial ? `<th style="text-align:right">Já entregue</th>` : ""}<th style="text-align:right">Separar</th><th style="text-align:center">OK</th></tr></thead><tbody>${rows || `<tr><td colspan="${partial ? 6 : 5}" class="empty">${partial ? "Tudo já foi entregue." : "Nenhum item para separar."}</td></tr>`}</tbody></table>`
    + `<section class="sign"><div>Separado por</div><div>Conferido por</div><div>Data</div></section>`
    + `<footer><span>${escape(plural(toPick.length, "produto", "produtos"))}${toPick.length ? ` · ${escape(totalsByUnit(toPick))}` : ""}, consolidados por produto.</span><span>Documento operacional — não é comprovante fiscal.</span></footer>`
    + `</div><script>window.onload=()=>window.print()<\/script></body></html>`;
}

export function openPickingPrintDocument(data: PickingDocument, openWindow: () => PrintWindow | null) {
  const popup = openWindow();
  if (!popup) return false;
  popup.document.write(buildPickingPrintDocument(data));
  popup.document.close();
  return true;
}
