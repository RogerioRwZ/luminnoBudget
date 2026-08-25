import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Download, FileArchive, Loader2 } from "lucide-react";

type PdfHistoryEntry = { id: number; fileName: string; fileSize: number; createdAt: Date; downloadUrl: string };
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function QuotePdfHistoryPanel({ quoteId }: { quoteId: number }) {
  const { data, isLoading, isError } = trpc.quote.pdfHistory.useQuery({ quoteId }, { enabled: quoteId > 0 });
  const entries = (data ?? []) as PdfHistoryEntry[];
  const download = (entry: PdfHistoryEntry) => {
    const link = document.createElement("a");
    link.href = entry.downloadUrl;
    link.download = entry.fileName;
    document.body.append(link);
    link.click();
    link.remove();
  };

  return <Card className="no-print border-border/70 shadow-sm"><CardHeader className="border-b border-border pb-4"><CardTitle className="flex items-center gap-2 font-display text-lg"><FileArchive className="h-4 w-4 text-primary"/>Histórico deste orçamento</CardTitle></CardHeader><CardContent className="p-0">{isLoading ? <div className="flex items-center justify-center gap-2 p-7 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Carregando PDFs…</div> : isError ? <p className="p-6 text-sm text-destructive">Não foi possível carregar o histórico de PDFs.</p> : entries.length ? <div className="divide-y divide-border">{entries.map((entry) => <div key={entry.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{entry.fileName}</p><p className="mt-1 text-xs text-muted-foreground">Gerado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.createdAt))} · {formatSize(entry.fileSize)}</p></div><Button size="sm" variant="outline" onClick={() => download(entry)}><Download className="mr-1.5 h-3.5 w-3.5"/>Baixar PDF</Button></div>)}</div> : <div className="p-7 text-center"><p className="text-sm font-semibold">Nenhum PDF salvo neste orçamento.</p><p className="mt-1 text-xs text-muted-foreground">Use “Gerar e salvar PDF” para registrar uma versão baixável.</p></div>}</CardContent></Card>;
}
