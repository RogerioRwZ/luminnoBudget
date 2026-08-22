import type { PickingItem } from "./picking";

type PickingDocument = { quote: { quoteNumber: number; clientName: string; professional: string }; items: PickingItem[]; issuedAt: string };
type PrintWindow = { document: { write: (html: string) => void; close: () => void } };
const escape = (value: string | number | null | undefined) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);

export function buildPickingPrintDocument(data: PickingDocument) {
  const rows = data.items.map((item, index) => `<tr><td>${index + 1}</td><td><b>#${escape(item.code)} — ${escape(item.shortDescription)}</b><br/><span>${escape(item.fullDescription)}</span></td><td>${escape(item.rooms.join(", "))}</td><td class="qty">${escape(item.quantity)} ${escape(item.unit)}</td><td class="check">□</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Separação — Orçamento #${escape(data.quote.quoteNumber)}</title><style>body{font-family:Arial,sans-serif;color:#111;margin:24px;font-size:12px}header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:16px}h1{font-size:20px;margin:0}h2{font-size:13px;margin:4px 0 0;color:#555}p{margin:3px 0}table{width:100%;border-collapse:collapse;margin-top:14px}th{text-align:left;background:#efefef;font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:9px}td{border-bottom:1px solid #ddd;padding:10px 9px;vertical-align:top}td span{display:block;margin-top:4px;line-height:1.35;color:#444}.qty{font-weight:700;text-align:center;white-space:nowrap}.check{font-size:19px;text-align:center;width:44px}footer{border-top:1px solid #111;margin-top:28px;padding-top:8px;font-size:10px;color:#555}@media print{body{margin:12mm}}</style></head><body><header><div><h1>LISTA DE SEPARAÇÃO</h1><h2>Orçamento #${escape(data.quote.quoteNumber)}</h2></div><div><p><b>Cliente:</b> ${escape(data.quote.clientName || "Não informado")}</p><p><b>Profissional:</b> ${escape(data.quote.professional || "Não informado")}</p><p><b>Emitido em:</b> ${escape(data.issuedAt)}</p></div></header><table><thead><tr><th>#</th><th>Produto / descrição completa</th><th>Ambientes</th><th>Separar</th><th>Conferido</th></tr></thead><tbody>${rows || "<tr><td colspan='5'>Nenhum item para separar.</td></tr>"}</tbody></table><footer>Documento operacional para separação de estoque. Itens consolidados por produto e quantidade.</footer><script>window.onload=()=>window.print()<\/script></body></html>`;
}

export function openPickingPrintDocument(data: PickingDocument, openWindow: () => PrintWindow | null) {
  const popup = openWindow();
  if (!popup) return false;
  popup.document.write(buildPickingPrintDocument(data));
  popup.document.close();
  return true;
}
