import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const eventLabels: Record<string, string> = { quote_sent: "Orçamento enviado", quote_approved: "Orçamento aprovado", quote_expiring: "Orçamento vencendo", quote_expired: "Orçamento vencido", payment_due: "Parcela a vencer", payment_overdue: "Parcela vencida", delivery_scheduled: "Entrega agendada", delivery_completed: "Entrega concluída" };

export default function OperationsPage() {
  const [quoteId, setQuoteId] = useState<number | undefined>();
  const [barcode, setBarcode] = useState("");
  const [comment, setComment] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [templateEvent, setTemplateEvent] = useState("quote_sent");
  const [templateName, setTemplateName] = useState("Mensagem padrão");
  const [templateBody, setTemplateBody] = useState("Olá, {{cliente}}. Segue o orçamento {{numero}}.");
  const quotes = trpc.quote.list.useQuery();
  const versions = trpc.quote.versions.useQuery({ quoteId: quoteId! }, { enabled: Boolean(quoteId) });
  const comments = trpc.quote.comments.useQuery({ quoteId: quoteId! }, { enabled: Boolean(quoteId) });
  const attachments = trpc.quote.attachments.useQuery({ quoteId: quoteId! }, { enabled: Boolean(quoteId) });
  const templates = trpc.templates.list.useQuery();
  const productLookup = trpc.product.findByBarcode.useQuery({ barcode }, { enabled: false });
  const utils = trpc.useUtils();
  const createVersion = trpc.quote.createVersion.useMutation({ onSuccess: () => { toast.success("Versão registrada"); setChangeNote(""); versions.refetch(); } });
  const addComment = trpc.quote.addComment.useMutation({ onSuccess: () => { toast.success("Comentário adicionado"); setComment(""); comments.refetch(); } });
  const resolveComment = trpc.quote.resolveComment.useMutation({ onSuccess: () => comments.refetch() });
  const uploadAttachment = trpc.quote.uploadAttachment.useMutation({ onSuccess: () => { toast.success("Anexo salvo"); attachments.refetch(); } });
  const saveTemplate = trpc.templates.save.useMutation({ onSuccess: () => { toast.success("Modelo salvo"); templates.refetch(); } });
  const selectedQuote = useMemo(() => quotes.data?.find((quote) => quote.id === quoteId), [quotes.data, quoteId]);

  async function scanBarcode(event: React.FormEvent) { event.preventDefault(); if (!barcode.trim()) return; const result = await productLookup.refetch(); if (result.data) toast.success(`${result.data.code} — ${result.data.shortDescription}`); else toast.error("Produto não encontrado"); }
  async function uploadFile(file?: File) { if (!file || !quoteId) return; if (!(["application/pdf", "image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) { toast.error("Use PDF, JPG, PNG ou WebP"); return; } const reader = new FileReader(); reader.onload = () => uploadAttachment.mutate({ quoteId, fileName: file.name, mimeType: file.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp", dataUrl: String(reader.result) }); reader.readAsDataURL(file); }

  return <div className="space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Operação</p><h1 className="font-display text-3xl font-bold tracking-tight">Ferramentas do dia a dia</h1><p className="mt-2 text-muted-foreground">Versione propostas, consulte produtos e organize informações internas da obra.</p></header>
    <Card><CardHeader><CardTitle>Selecionar orçamento</CardTitle></CardHeader><CardContent><select aria-label="Orçamento das ferramentas operacionais" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={quoteId ?? ""} onChange={(event) => setQuoteId(Number(event.target.value) || undefined)}><option value="">Selecione um orçamento</option>{quotes.data?.map((quote) => <option key={quote.id} value={quote.id}>#{quote.quoteNumber} — {quote.clientName}</option>)}</select>{selectedQuote ? <p className="mt-2 text-xs text-muted-foreground">Status: {selectedQuote.status}</p> : null}</CardContent></Card>
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Leitor de código de barras</CardTitle></CardHeader><CardContent><form onSubmit={scanBarcode} className="flex gap-2"><Input aria-label="Código de barras" autoFocus placeholder="Use leitor USB ou digite o código" value={barcode} onChange={(event) => setBarcode(event.target.value)} /><Button type="submit" disabled={productLookup.isFetching}>Consultar</Button></form>{productLookup.data ? <div className="mt-4 rounded-lg bg-muted p-3 text-sm"><strong>{productLookup.data.code}</strong> — {productLookup.data.shortDescription}<br /><span className="text-muted-foreground">Saldo: {productLookup.data.stockQuantity} {productLookup.data.unit}</span></div> : null}</CardContent></Card>
      <Card><CardHeader><CardTitle>Nova versão da proposta</CardTitle></CardHeader><CardContent><Label htmlFor="change-note">Motivo da alteração</Label><Input id="change-note" className="mt-2" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="Ex.: ajuste de acabamento e prazo" /><Button className="mt-3" disabled={!quoteId || createVersion.isPending} onClick={() => quoteId && createVersion.mutate({ quoteId, changeNote: changeNote || null })}>Registrar versão atual</Button><div className="mt-4 space-y-2">{versions.data?.map((version) => <div key={version.id} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>Versão {version.versionNumber}{version.changeNote ? ` — ${version.changeNote}` : ""}</span><span className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</span></div>)}</div></CardContent></Card>
      <Card><CardHeader><CardTitle>Comentários internos</CardTitle></CardHeader><CardContent><Textarea aria-label="Novo comentário interno" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Visível somente para a equipe" /><Button className="mt-3" disabled={!quoteId || !comment.trim() || addComment.isPending} onClick={() => quoteId && addComment.mutate({ quoteId, body: comment })}>Adicionar comentário</Button><div className="mt-4 space-y-2">{comments.data?.map((item) => <div key={item.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-2"><span className={item.resolved ? "line-through text-muted-foreground" : ""}>{item.body}</span><Button variant="ghost" size="sm" onClick={() => resolveComment.mutate({ id: item.id, resolved: !item.resolved })}>{item.resolved ? "Reabrir" : "Resolver"}</Button></div><p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p></div>)}</div></CardContent></Card>
      <Card><CardHeader><CardTitle>Plantas e anexos</CardTitle></CardHeader><CardContent><Label htmlFor="quote-attachment">Adicionar PDF ou imagem</Label><Input id="quote-attachment" className="mt-2" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={!quoteId || uploadAttachment.isPending} onChange={(event) => uploadFile(event.target.files?.[0])} /><div className="mt-4 space-y-2">{attachments.data?.map((file) => <div key={file.id} className="flex justify-between rounded-lg border p-3 text-sm"><a className="truncate underline decoration-primary/40 underline-offset-4 hover:text-primary" href={`/api/quote-attachments/${file.id}/download`}>{file.fileName}</a><Badge variant="secondary">{Math.ceil(file.fileSize / 1024)} KB</Badge></div>)}</div></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Modelos por evento</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-3"><div><Label htmlFor="template-event">Evento</Label><select id="template-event" aria-label="Evento do modelo" className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm" value={templateEvent} onChange={(event) => setTemplateEvent(event.target.value)}>{Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><Label htmlFor="template-name">Nome</Label><Input id="template-name" className="mt-2" value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></div><div className="md:col-span-3"><Label htmlFor="template-body">Mensagem</Label><Textarea id="template-body" className="mt-2" value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Variáveis disponíveis: {'{{cliente}}'}, {'{{numero}}'}, {'{{valor}}'}, {'{{vencimento}}'}.</p></div></div><Button className="mt-3" disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate({ event: templateEvent as "quote_sent", name: templateName, body: templateBody, active: true })}>Salvar modelo</Button><div className="mt-4 grid gap-2 md:grid-cols-2">{templates.data?.map((template) => <div key={template.id} className="rounded-lg border p-3 text-sm"><strong>{template.name}</strong><p className="text-muted-foreground">{eventLabels[template.event] ?? template.event}</p><p className="mt-1 line-clamp-2">{template.body}</p></div>)}</div></CardContent></Card>
  </div>;
}
