import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { dateOnly, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { buildFollowUpMessage, LOST_REASON_LABELS, type LostReason } from "@shared/followUp";
import { plural } from "@shared/plural";
import { normalizeWhatsAppPhone } from "@shared/whatsapp";
import { ArrowRight, Check, Clock, MessageCircle, PhoneCall, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type FollowUp = { id: number; quoteNumber: number; clientName: string; phone: string | null; followUpAt: Date | string; total: number };

// Propostas em negociação com retorno marcado para hoje ou atrasado.
export function FollowUpPanel({ followUps, brand, followUpDays }: { followUps: FollowUp[]; brand: string; followUpDays: number }) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const done = trpc.quote.followUpDone.useMutation({
    onSuccess: result => {
      utils.dashboard.invalidate();
      toast.success(`Próximo retorno do #${result.quoteNumber} em ${dateOnly(result.followUpAt)}.`);
    },
    onError: () => toast.error("Não foi possível registrar o retorno."),
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const contact = (item: FollowUp) => {
    const text = buildFollowUpMessage({ brand, quoteNumber: item.quoteNumber, clientName: item.clientName, total: item.total });
    const phone = normalizeWhatsAppPhone(item.phone ?? "");
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      return;
    }
    void navigator.clipboard?.writeText(text).then(
      () => toast.info("Telefone não cadastrado: mensagem copiada para enviar manualmente."),
      () => toast.error("Cadastre o telefone do cliente para enviar pelo WhatsApp.")
    );
  };

  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <PhoneCall className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold">Retornos de hoje</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Propostas em negociação com contato marcado para hoje ou atrasado.
              "Retorno feito" agenda o próximo em {plural(followUpDays, "dia", "dias")}.
            </p>
          </div>
        </div>
        {followUps.length ? (
          <div className="divide-y divide-border">
            {followUps.map(item => {
              const late = new Date(item.followUpAt) < today;
              return (
                <div key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <button onClick={() => setLocation(`/orcamentos/${item.id}`)} className="min-w-0 text-left">
                    <p className="truncate text-sm font-bold">
                      #{item.quoteNumber} · {item.clientName || "Cliente não informado"}
                    </p>
                    <p className={`mt-0.5 flex items-center gap-1 text-xs ${late ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
                      <Clock className="h-3 w-3" />
                      {late ? `Atrasado desde ${dateOnly(item.followUpAt)}` : "Hoje"} · {money(item.total)}
                    </p>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => contact(item)}>
                      <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                      WhatsApp
                    </Button>
                    <Button size="sm" variant="outline" disabled={done.isPending} onClick={() => done.mutate({ id: item.id, days: 1 })}>
                      Amanhã
                    </Button>
                    <Button size="sm" disabled={done.isPending} onClick={() => done.mutate({ id: item.id, days: followUpDays })}>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Retorno feito
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Nenhum retorno pendente hoje.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type LossSummary = { reasons: Array<{ reason: LostReason; count: number; value: number }>; withoutReason: number; total: number };

export function LossReasonsCard({ summary }: { summary: LossSummary }) {
  const [, setLocation] = useLocation();
  const max = Math.max(1, ...summary.reasons.map(entry => entry.count));
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold">Por que não fechamos</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Motivos das propostas não aprovadas nos últimos 6 meses.
            </p>
          </div>
          <ThumbsDown className="h-5 w-5 text-red-600 dark:text-red-300" />
        </div>
        {summary.reasons.length ? (
          <div className="space-y-3">
            {summary.reasons.map(entry => (
              <div key={entry.reason}>
                <div className="flex justify-between gap-3 text-xs">
                  <span className="font-semibold">{LOST_REASON_LABELS[entry.reason]}</span>
                  <span className="text-muted-foreground">
                    {plural(entry.count, "proposta", "propostas")} · {money(entry.value)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${Math.max(6, Math.round((entry.count / max) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Nenhum motivo registrado ainda. Ao marcar uma proposta como não
            aprovada, o sistema pede o motivo.
          </p>
        )}
        {summary.withoutReason ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {plural(summary.withoutReason, "proposta antiga sem motivo", "propostas antigas sem motivo")} registrado.{" "}
            <button className="font-semibold text-foreground underline-offset-2 hover:underline" onClick={() => setLocation("/orcamentos")}>
              Ver orçamentos <ArrowRight className="inline h-3 w-3" />
            </button>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
