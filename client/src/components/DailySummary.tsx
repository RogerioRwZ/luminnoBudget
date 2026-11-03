import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { dateOnly, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { APPOINTMENT_TYPE_LABELS } from "@shared/agenda";
import { buildDailySummaryText, dailySummaryCount, type DailySummary } from "@shared/dailySummary";
import { plural } from "@shared/plural";
import { AFTER_SALES_TYPE_LABELS } from "@shared/afterSales";
import { Bell, CalendarDays, Copy, DatabaseBackup, LifeBuoy, Lightbulb, MessageCircle, PackageCheck, PhoneCall, ShoppingCart, Timer, WalletCards } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { PhoneSetup } from "./PhoneSetup";

const todayKey = () => new Date().toLocaleDateString("sv-SE");
const storage = {
  get(key: string) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Navegação privada: o resumo só não abre sozinho.
    }
  },
};
const time = (value: Date | string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function Section({ icon: Icon, title, count, action, onAction, children }: { icon: typeof Bell; title: string; count: number; action: string; onAction: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Icon className="h-4 w-4 text-primary" />
          {title}
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold">{count}</span>
        </p>
        <button className="text-xs font-semibold text-primary hover:underline" onClick={onAction}>{action}</button>
      </div>
      <div className="mt-2 space-y-1 text-xs">{children}</div>
    </section>
  );
}

function SummaryBody({ summary, go }: { summary: DailySummary; go: (path: string) => void }) {
  const installmentCount = summary.installments ? summary.installments.dueToday.count + summary.installments.overdue.count : 0;
  return (
    <div className="space-y-3">
      {summary.appointments ? (
        <Section icon={CalendarDays} title="Agenda de hoje" count={summary.appointments.count} action="Abrir agenda" onAction={() => go("/agenda")}>
          {summary.appointments.items.map(item => (
            <p key={item.id} className="truncate">
              <b>{time(item.scheduledAt)}</b> {APPOINTMENT_TYPE_LABELS[item.type]} — {item.clientName}
              {item.responsible ? <span className="text-muted-foreground"> · {item.responsible}</span> : null}
            </p>
          ))}
        </Section>
      ) : null}
      {summary.followUps ? (
        <Section icon={PhoneCall} title="Retornos de propostas" count={summary.followUps.count} action="Ver painel" onAction={() => go("/")}>
          {summary.followUps.items.map(item => (
            <button key={item.id} className="block w-full truncate text-left hover:underline" onClick={() => go(`/orcamentos/${item.id}`)}>
              #{item.quoteNumber} {item.clientName || "sem cliente"} · {money(item.total)}
              {item.late ? <span className="font-semibold text-red-700 dark:text-red-300"> · atrasado</span> : null}
            </button>
          ))}
        </Section>
      ) : null}
      {summary.expiring ? (
        <Section icon={Timer} title="Propostas vencendo hoje" count={summary.expiring.count} action="Ver orçamentos" onAction={() => go("/orcamentos")}>
          {summary.expiring.items.map(item => (
            <button key={item.id} className="block w-full truncate text-left hover:underline" onClick={() => go(`/orcamentos/${item.id}`)}>
              #{item.quoteNumber} {item.clientName || "sem cliente"} · {money(item.total)}
            </button>
          ))}
        </Section>
      ) : null}
      {summary.installments ? (
        <Section icon={WalletCards} title="Parcelas a receber" count={installmentCount} action="Abrir financeiro" onAction={() => go("/financeiro")}>
          {summary.installments.dueToday.count ? <p>{plural(summary.installments.dueToday.count, "vence", "vencem")} hoje: <b>{money(summary.installments.dueToday.amount)}</b></p> : null}
          {summary.installments.overdue.count ? <p className="text-red-700 dark:text-red-300">{plural(summary.installments.overdue.count, "atrasada", "atrasadas")}: <b>{money(summary.installments.overdue.amount)}</b></p> : null}
          {summary.installments.items.slice(0, 4).map(item => (
            <p key={item.id} className="truncate text-muted-foreground">
              {item.clientName}{item.quoteNumber ? ` #${item.quoteNumber}` : ""} · {item.installmentNumber}/{item.installmentCount} · {money(item.remainingAmount)} · {dateOnly(item.dueDate)}
            </p>
          ))}
        </Section>
      ) : null}
      {summary.deliveries ? (
        <Section icon={PackageCheck} title="Prontos para retirada" count={summary.deliveries.count} action="Abrir estoque" onAction={() => go("/estoque")}>
          {summary.deliveries.items.map(item => (
            <p key={item.quoteId} className="truncate">#{item.quoteNumber} {item.clientName} · {plural(item.lines, "item", "itens")}</p>
          ))}
        </Section>
      ) : null}
      {summary.loans ? (
        <Section icon={Lightbulb} title="Mostruário para devolver" count={summary.loans.count} action="Abrir mostruário" onAction={() => go("/mostruario")}>
          {summary.loans.items.map(item => (
            <p key={item.id} className="truncate">
              #{item.id} {item.borrowerName} · {item.pending} peça(s) · até {dateOnly(item.dueDate)}
              {item.overdue ? <span className="font-semibold text-red-700 dark:text-red-300"> · atrasado</span> : null}
            </p>
          ))}
        </Section>
      ) : null}
      {summary.afterSales ? (
        <Section icon={LifeBuoy} title="Pós-venda com prazo até hoje" count={summary.afterSales.count} action="Abrir pós-venda" onAction={() => go("/pos-venda")}>
          {summary.afterSales.items.map(item => (
            <p key={item.id} className="truncate">
              {AFTER_SALES_TYPE_LABELS[item.type]} #{item.id} — {item.clientName} · {item.productDescription}
              {item.overdue ? <span className="font-semibold text-red-700 dark:text-red-300"> · atrasado</span> : null}
            </p>
          ))}
        </Section>
      ) : null}
      {summary.backup ? (
        <Section icon={DatabaseBackup} title={summary.backup.state === "failed" ? "O último backup falhou" : "Backup atrasado"} count={1} action="Ver status" onAction={() => go("/administracao")}>
          <p className="text-red-700 dark:text-red-300">
            {summary.backup.lastSuccessAt ? `Último backup completo em ${dateOnly(summary.backup.lastSuccessAt)} às ${time(summary.backup.lastSuccessAt)}.` : "Nenhum backup completo registrado."}
            {summary.backup.error ? ` ${summary.backup.error}` : ""}
          </p>
        </Section>
      ) : null}
      {summary.purchases ? (
        <Section icon={ShoppingCart} title="Aguardando compra" count={summary.purchases.products} action="Abrir compras" onAction={() => go("/compras")}>
          <p className="text-muted-foreground">Para {plural(summary.purchases.quotesWaiting, "pedido aprovado", "pedidos aprovados")}.</p>
          {summary.purchases.items.slice(0, 4).map(item => (
            <p key={item.productId} className="truncate">{item.quantity} {item.unit} · {item.shortDescription}{item.supplierName ? <span className="text-muted-foreground"> · {item.supplierName}</span> : null}</p>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

// Sino no cabeçalho com o resumo do dia; abre sozinho na primeira vez que a
// pessoa entra no dia (dá para desligar).
export function DailySummaryButton({ userId }: { userId: number }) {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const { data } = trpc.summary.today.useQuery(undefined, { refetchInterval: 5 * 60_000, refetchOnWindowFocus: true });
  const { data: settings } = trpc.settings.get.useQuery(undefined, { staleTime: 5 * 60_000 });
  const autoKey = `luminno-summary-auto-${userId}`;
  const seenKey = `luminno-summary-seen-${userId}`;
  const [autoOpen, setAutoOpen] = useState(() => storage.get(autoKey) !== "off");
  const count = dailySummaryCount(data);

  // Vindo do aviso no celular (/?resumo=1): abre o resumo direto.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("resumo")) return;
    params.delete("resumo");
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    storage.set(seenKey, todayKey());
    setOpen(true);
  }, [seenKey]);

  useEffect(() => {
    if (!data || !count || !autoOpen || storage.get(seenKey) === todayKey()) return;
    storage.set(seenKey, todayKey());
    setOpen(true);
  }, [autoOpen, count, data, seenKey]);

  const text = data ? buildDailySummaryText(data, settings?.tradingName || "Luminno") : "";
  const go = (path: string) => {
    setOpen(false);
    setLocation(path);
  };
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:text-foreground"
        aria-label={count ? `Resumo do dia: ${plural(count, "pendência", "pendências")}` : "Resumo do dia"}
      >
        <Bell className="h-4 w-4" />
        {count ? (
          <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resumo do dia</DialogTitle>
            <DialogDescription>
              {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date())} ·{" "}
              {count ? plural(count, "pendência", "pendências") : "nada pendente"} nas áreas do seu perfil.
            </DialogDescription>
          </DialogHeader>
          {data && count ? (
            <SummaryBody summary={data} go={go} />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {data ? "Nenhuma pendência para hoje. ✅" : "Carregando…"}
            </p>
          )}
          <PhoneSetup />
          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={autoOpen}
                onCheckedChange={value => {
                  setAutoOpen(value);
                  storage.set(autoKey, value ? "on" : "off");
                }}
                aria-label="Abrir o resumo ao entrar"
              />
              Abrir ao entrar no sistema
            </label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!data}
                onClick={() =>
                  navigator.clipboard?.writeText(text).then(
                    () => toast.success("Resumo copiado."),
                    () => toast.error("Não foi possível copiar o resumo.")
                  )
                }
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copiar
              </Button>
              <Button size="sm" disabled={!data} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")}>
                <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                WhatsApp
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
