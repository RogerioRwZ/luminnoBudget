import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Download, FileArchive, FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

type PdfHistoryEntry = { id: number; quoteId: number; quoteNumber: number | null; clientName: string | null; fileName: string; fileSize: number; createdAt: Date; downloadUrl: string };
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function PdfHistoryPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = trpc.quote.pdfHistoryAll.useQuery();
  const [search, setSearch] = useState("");
  const entries = (data ?? []) as PdfHistoryEntry[];
  const filtered = useMemo(() => entries.filter((entry) => `${entry.quoteNumber ?? ""} ${entry.clientName ?? ""} ${entry.fileName}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))), [entries, search]);
  const download = (entry: PdfHistoryEntry) => {
    const link = document.createElement("a");
    link.href = entry.downloadUrl;
    link.download = entry.fileName;
    document.body.append(link);
    link.click();
    link.remove();
  };

  return <div className="mx-auto max-w-6xl space-y-6"><div><p className="eyebrow">Central de documentos</p><h2 className="page-title">Histórico de PDFs</h2><p className="page-description">Acesse e baixe rapidamente as versões de orçamento já geradas pela equipe.</p></div><Card className="border-border/70 shadow-sm"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por orçamento, cliente ou arquivo" className="h-10 pl-9"/></div><span className="text-xs text-muted-foreground">{filtered.length} documento(s)</span></div>{isLoading ? <div className="p-10 text-center text-sm text-muted-foreground">Carregando histórico…</div> : filtered.length ? <div className="divide-y divide-border">{filtered.map((entry) => <div key={entry.id} className="flex flex-col gap-4 p-4 transition hover:bg-muted/30 md:flex-row md:items-center"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileArchive className="h-5 w-5"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold">{entry.clientName || "Orçamento removido"}</p><Badge variant="secondary">{entry.quoteNumber ? `Orçamento #${entry.quoteNumber}` : "Histórico preservado"}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">Gerado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.createdAt))} · {formatSize(entry.fileSize)}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => download(entry)}><Download className="mr-1.5 h-3.5 w-3.5"/>Baixar PDF</Button>{entry.quoteNumber ? <Button size="sm" onClick={() => setLocation(`/orcamentos/${entry.quoteId}`)}>Abrir orçamento</Button> : null}</div></div>)}</div> : <div className="p-12 text-center"><FileText className="mx-auto h-8 w-8 text-muted-foreground"/><p className="mt-3 text-sm font-bold">Nenhum PDF gerado ainda.</p><p className="mt-1 text-xs text-muted-foreground">Abra um orçamento e use a ação de gerar PDF para registrar sua primeira versão.</p></div>}</CardContent></Card></div>;
}
