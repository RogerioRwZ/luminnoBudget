import { AsyncButton, getFormErrorMessage } from "@/components/FormFeedback";
import { CameraBarcodeScanner } from "@/components/CameraBarcodeScanner";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { distributePicked } from "@shared/picking";
import { plural } from "@shared/plural";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Minus,
  PackageCheck,
  Plus,
  RotateCcw,
  ScanBarcode,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";

type Feedback = { tone: "ok" | "warn" | "error"; message: string } | null;
const quantity = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Bipe curto: agudo para acerto, grave para erro. Sem som, segue em silêncio.
function beep(ok: boolean) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioCtx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (ok ? 0.08 : 0.25));
    oscillator.onended = () => context.close();
  } catch {
    // Navegador sem áudio: a mensagem na tela basta.
  }
}

const storageKey = (quoteId: number) => `luminno-conferencia-${quoteId}`;
function loadPicked(quoteId: number): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(quoteId)) || "{}");
  } catch {
    return {};
  }
}

export default function PickingCheckPage() {
  const params = useParams<{ id: string }>();
  const quoteId = Number(params.id);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { can } = usePermissions();
  const picking = trpc.inventory.picking.useQuery(
    { quoteId },
    { enabled: Number.isInteger(quoteId) && quoteId > 0 }
  );
  const [picked, setPicked] = useState<Record<string, number>>(() => loadPicked(quoteId));
  const [code, setCode] = useState("");
  const [multiplier, setMultiplier] = useState(1);
  const [responsible, setResponsible] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(quoteId), JSON.stringify(picked));
    } catch {
      // Sem armazenamento: a conferência só não sobrevive a um recarregar.
    }
  }, [picked, quoteId]);

  const items = useMemo(
    () => (picking.data?.items ?? []).filter(item => item.quantity > 0),
    [picking.data]
  );
  const approved = picking.data?.quote.status === "approved";
  const totalPending = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPicked = items.reduce((sum, item) => sum + Math.min(picked[item.key] ?? 0, item.quantity), 0);
  const progress = totalPending ? Math.round((totalPicked / totalPending) * 100) : 0;
  const plan = items
    .filter(item => (picked[item.key] ?? 0) > 0)
    .map(item => ({ item, ...distributePicked(item, picked[item.key]!) }));
  const blocked = plan.filter(entry => entry.leftover > 0);
  const lines = plan.flatMap(entry => entry.lines);

  const add = (key: string, delta: number) =>
    setPicked(current => {
      const item = items.find(candidate => candidate.key === key);
      if (!item) return current;
      const next = round(Math.min(item.quantity, Math.max(0, (current[key] ?? 0) + delta)));
      return { ...current, [key]: next };
    });

  const scan = (event: FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    setCode("");
    scanRef.current?.focus();
    processCode(value);
  };
  // Mesmo tratamento para leitor USB, código digitado e câmera.
  const processCode = (value: string) => {
    if (!value) return;
    const normalized = value.toLocaleLowerCase("pt-BR");
    const item = items.find(
      candidate =>
        (candidate.barcode && candidate.barcode.toLocaleLowerCase("pt-BR") === normalized) ||
        candidate.code.toLocaleLowerCase("pt-BR") === normalized
    );
    if (!item) {
      beep(false);
      setFeedback({ tone: "error", message: `Código ${value} não pertence a este orçamento (ou já foi entregue). Separe o produto de volta.` });
      return;
    }
    const current = picked[item.key] ?? 0;
    if (current + multiplier > item.quantity) {
      beep(false);
      setFeedback({ tone: "warn", message: `${item.shortDescription}: já conferido por completo (${quantity(item.quantity)} ${item.unit}). Não separe a mais.` });
      return;
    }
    beep(true);
    add(item.key, multiplier);
    setFeedback({ tone: "ok", message: `${item.shortDescription} +${quantity(multiplier)} · ${quantity(current + multiplier)} de ${quantity(item.quantity)} ${item.unit}` });
  };

  const deliver = trpc.inventory.deliverMany.useMutation({
    onSuccess: results => {
      toast.success(`Retirada registrada: ${plural(results.length, "item", "itens")}.`);
      setPicked({});
      setFeedback(null);
      utils.inventory.invalidate();
    },
    onError: error =>
      toast.error(getFormErrorMessage(error, "Não foi possível registrar a retirada. Atualize a página e tente novamente.")),
  });

  if (picking.isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Carregando separação…</p>;
  }
  if (picking.error || !picking.data) {
    return (
      <div role="alert" className="space-y-3 py-16 text-center text-sm text-muted-foreground">
        <p>Não foi possível carregar este orçamento.</p>
        <Button variant="outline" size="sm" onClick={() => picking.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  const { quote } = picking.data;
  const feedbackStyle = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    error: "border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-100",
  };
  const FeedbackIcon = feedback?.tone === "ok" ? CheckCircle2 : feedback?.tone === "warn" ? AlertTriangle : XCircle;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Conferência da separação</p>
          <h2 className="page-title">
            Orçamento #{quote.quoteNumber}
          </h2>
          <p className="page-description">
            {quote.clientName || "Cliente não informado"}. Bipe cada produto
            com o leitor; o código interno do produto também é aceito.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setLocation("/estoque")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Estoque
          </Button>
          {can("quotes") ? (
            <Button variant="outline" onClick={() => setLocation(`/orcamentos/${quote.id}`)}>
              Abrir orçamento
            </Button>
          ) : null}
        </div>
      </div>

      {items.length ? (
        <>
          <Card className="border-border/70 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <form onSubmit={scan} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="scan-code">Código de barras</Label>
                  <div className="relative">
                    <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="scan-code"
                      ref={scanRef}
                      autoFocus
                      autoComplete="off"
                      inputMode="numeric"
                      value={code}
                      onChange={event => setCode(event.target.value)}
                      placeholder="Bipe o produto ou digite o código e tecle Enter"
                      className="h-12 pl-11 text-base"
                    />
                  </div>
                </div>
                <div className="w-full space-y-2 sm:w-32">
                  <Label htmlFor="scan-multiplier">Qtd. por leitura</Label>
                  <Input
                    id="scan-multiplier"
                    type="number"
                    min="1"
                    step="1"
                    value={multiplier}
                    onChange={event => setMultiplier(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                    className="h-12"
                  />
                </div>
                {/* Com dois campos, o Enter do leitor só envia o formulário
                    se houver um botão de envio. */}
                <Button type="submit" className="h-12 px-5">
                  Lançar
                </Button>
              </form>
              <CameraBarcodeScanner
                continuous
                label="Ler com a câmera do celular"
                onDetected={processCode}
              />
              {feedback ? (
                <div role="status" aria-live="polite" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${feedbackStyle[feedback.tone]}`}>
                  <FeedbackIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{feedback.message}</p>
                </div>
              ) : null}
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>Conferido</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} aria-label="Andamento da conferência" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="font-display text-lg">
                Itens a separar
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {items.map(item => {
                  const count = picked[item.key] ?? 0;
                  const done = count >= item.quantity;
                  return (
                    <div key={item.key} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${done ? "bg-emerald-500/5" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-bold">
                          {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> : null}
                          {item.shortDescription}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Cód. {item.code}
                          {item.barcode ? ` · EAN ${item.barcode}` : " · sem código de barras, use os botões"}
                          {" · "}
                          {item.rooms.join(", ")}
                        </p>
                        {approved && item.deliverableQuantity < item.quantity ? (
                          <Badge variant="secondary" className="mt-2 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300">
                            {item.productId
                              ? `Só ${quantity(item.deliverableQuantity)} reservado; o resto aguarda compra`
                              : "Item avulso"}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" aria-label={`Tirar 1 de ${item.shortDescription}`} onClick={() => add(item.key, -1)} disabled={!count}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <p className="min-w-24 text-center font-display text-lg font-bold">
                          {quantity(count)}
                          <span className="text-sm font-normal text-muted-foreground">
                            {" "}/ {quantity(item.quantity)} {item.unit}
                          </span>
                        </p>
                        <Button size="icon" variant="outline" aria-label={`Somar 1 de ${item.shortDescription}`} onClick={() => add(item.key, 1)} disabled={done}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardContent className="space-y-4 p-5">
              {!approved ? (
                <p className="text-sm text-muted-foreground">
                  Este orçamento ainda não está aprovado: a conferência serve
                  só para separar. A retirada é registrada depois da aprovação.
                </p>
              ) : blocked.length ? (
                <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
                  Conferido além do reservado em:{" "}
                  {blocked.map(entry => `${entry.item.shortDescription} (${quantity(entry.leftover)} a mais)`).join(", ")}.
                  Registre a entrada no estoque ou ajuste a conferência.
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="check-responsible">Quem retirou ou entregou (opcional)</Label>
                  <Input id="check-responsible" value={responsible} onChange={event => setResponsible(event.target.value)} placeholder="Ex.: cliente, motorista" />
                </div>
                <Button variant="outline" onClick={() => { setPicked({}); setFeedback(null); scanRef.current?.focus(); }} disabled={!totalPicked}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Recomeçar
                </Button>
                <AsyncButton
                  pending={deliver.isPending}
                  loadingLabel="Registrando…"
                  disabled={!approved || !lines.length || blocked.length > 0}
                  onClick={() => deliver.mutate({ quoteId: quote.id, lines, responsible: responsible || null, notes: "Conferido com leitor de código de barras", deliveredAt: new Date() })}
                >
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Registrar retirada do conferido
                </AsyncButton>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="py-12 text-center">
            <PackageCheck className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-300" />
            <p className="mt-3 text-sm font-semibold">Nada a separar neste orçamento.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Todos os itens já foram entregues ou o orçamento está vazio.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
