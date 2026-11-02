// "Orçamento 0012 - Maria Silva - Arq. Paulo.pdf". O profissional só entra
// quando informado; caracteres proibidos em nomes de arquivo viram espaço.
export function quotePdfFileName(quote: { quoteNumber: number; clientName?: string | null; professional?: string | null }) {
  const parts = [`Orçamento ${String(quote.quoteNumber).padStart(4, "0")}`, quote.clientName, quote.professional]
    .map(part => (part ?? "").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return `${parts.join(" - ").slice(0, 170).trim()}.pdf`;
}
