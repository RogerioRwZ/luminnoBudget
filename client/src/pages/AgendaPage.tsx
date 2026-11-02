import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AsyncButton, FormError, getFormErrorMessage } from "@/components/FormFeedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  buildAppointmentMessage,
  weekRange,
} from "@shared/agenda";
import { whatsappLink } from "@shared/messages";
import { normalizeWhatsAppPhone } from "@shared/whatsapp";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  MessageCircle,
  Pencil,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useSearch } from "wouter";

type AppointmentType = keyof typeof APPOINTMENT_TYPE_LABELS;
type Form = {
  id?: number;
  type: AppointmentType;
  quoteId: number | null;
  clientId: number | null;
  clientName: string;
  phone: string;
  address: string;
  date: string;
  time: string;
  durationMinutes: number;
  responsible: string;
  notes: string;
};

const pad = (value: number) => String(value).padStart(2, "0");
const toDateInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const fromInputs = (date: string, time: string) => new Date(`${date}T${time || "00:00"}`);
const timeOf = (date: Date) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
const durations = [30, 60, 90, 120, 180, 240, 480];
const durationLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes % 60 ? `${Math.floor(minutes / 60)}h${minutes % 60}` : `${minutes / 60}h`);
const typeStyle: Record<AppointmentType, string> = {
  delivery: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  technical_visit: "bg-sky-500/10 text-sky-800 dark:text-sky-200",
  installation: "bg-violet-500/10 text-violet-800 dark:text-violet-200",
};
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

function emptyForm(day: Date): Form {
  return { type: "delivery", quoteId: null, clientId: null, clientName: "", phone: "", address: "", date: toDateInput(day), time: "09:00", durationMinutes: 60, responsible: "", notes: "" };
}

export default function AgendaPage() {
  const utils = trpc.useUtils();
  const search = useSearch();
  const [reference, setReference] = useState(() => new Date());
  const [typeFilter, setTypeFilter] = useState<AppointmentType | "all">("all");
  const range = useMemo(() => weekRange(reference), [reference]);
  const { data = [], isLoading, error, refetch } = trpc.agenda.list.useQuery({ from: range.from, to: range.to });
  const { data: quotes = [] } = trpc.quote.list.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => emptyForm(new Date()));
  const [formError, setFormError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<(typeof data)[number] | null>(null);

  const selectableQuotes = quotes.filter(quote => quote.status !== "lost");
  const applyQuote = (quoteId: number | null, base: Form): Form => {
    const quote = quotes.find(candidate => candidate.id === quoteId);
    if (!quote) return { ...base, quoteId: null };
    return { ...base, quoteId: quote.id, clientId: quote.clientId ?? null, clientName: quote.clientName || base.clientName, phone: quote.phone || base.phone, address: quote.address || base.address };
  };

  // Vindo do orçamento (?orcamento=ID), abre o formulário já preenchido.
  const [handledQuery, setHandledQuery] = useState(false);
  useEffect(() => {
    if (handledQuery || !quotes.length) return;
    const quoteId = Number(new URLSearchParams(search).get("orcamento"));
    setHandledQuery(true);
    if (!quoteId) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setForm(applyQuote(quoteId, emptyForm(tomorrow)));
    setFormError("");
    setOpen(true);
  }, [quotes, search, handledQuery]);

  const scheduledAt = fromInputs(form.date, form.time);
  const conflicts = trpc.agenda.conflicts.useQuery(
    { id: form.id, responsible: form.responsible, scheduledAt, durationMinutes: form.durationMinutes },
    { enabled: open && Boolean(form.responsible.trim()) && !Number.isNaN(scheduledAt.getTime()) }
  );

  const save = trpc.agenda.save.useMutation({
    onSuccess: saved => {
      utils.agenda.invalidate();
      setOpen(false);
      setReference(new Date(saved.scheduledAt));
      toast.success(form.id ? "Agendamento atualizado" : "Agendamento criado");
    },
    onError: error => setFormError(getFormErrorMessage(error, "Não foi possível salvar o agendamento. Confira os campos e tente novamente.")),
  });
  const setStatus = trpc.agenda.setStatus.useMutation({
    onSuccess: saved => {
      utils.agenda.invalidate();
      toast.success(`Marcado como ${APPOINTMENT_STATUS_LABELS[saved.status].toLowerCase()}`);
    },
    onError: error => toast.error(getFormErrorMessage(error, "Não foi possível alterar o agendamento.")),
  });
  const remove = trpc.agenda.delete.useMutation({
    onSuccess: () => {
      utils.agenda.invalidate();
      setPendingDelete(null);
      toast.success("Agendamento excluído");
    },
    onError: error => toast.error(getFormErrorMessage(error, "Não foi possível excluir o agendamento.")),
  });

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(range.from);
    day.setDate(day.getDate() + index);
    return day;
  });
  const visible = data.filter(item => typeFilter === "all" || item.type === typeFilter);
  const today = toDateInput(new Date());
  const weekLabel = `${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(days[0]!)} a ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(days[6]!)}`;
  const shiftWeek = (weeks: number) => setReference(current => { const next = new Date(current); next.setDate(next.getDate() + weeks * 7); return next; });

  const openNew = (day: Date) => {
    setForm(emptyForm(day));
    setFormError("");
    setOpen(true);
  };
  const openEdit = (item: (typeof data)[number]) => {
    const at = new Date(item.scheduledAt);
    setForm({ id: item.id, type: item.type, quoteId: item.quoteId, clientId: item.clientId, clientName: item.clientName, phone: item.phone ?? "", address: item.address ?? "", date: toDateInput(at), time: toTimeInput(at), durationMinutes: item.durationMinutes, responsible: item.responsible ?? "", notes: item.notes ?? "" });
    setFormError("");
    setOpen(true);
  };
  const submit = () => {
    if (!form.clientName.trim()) return setFormError("Informe o cliente.");
    if (Number.isNaN(scheduledAt.getTime())) return setFormError("Informe data e horário válidos.");
    save.mutate({ id: form.id, type: form.type, quoteId: form.quoteId, clientId: form.clientId, clientName: form.clientName.trim(), phone: form.phone || null, address: form.address || null, scheduledAt, durationMinutes: form.durationMinutes, responsible: form.responsible || null, notes: form.notes || null });
  };
  const confirmByWhatsApp = (item: (typeof data)[number]) => {
    const phone = normalizeWhatsAppPhone(item.phone ?? "");
    if (!phone) return toast.error("Cadastre o telefone do cliente para enviar pelo WhatsApp.");
    const text = buildAppointmentMessage({ brand: settings?.tradingName || "Luminno", type: item.type, clientName: item.clientName, scheduledAt: new Date(item.scheduledAt), address: item.address, quoteNumber: item.quoteNumber });
    window.open(whatsappLink(phone, text), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Operação e expedição</p>
          <h2 className="page-title">Agenda</h2>
          <p className="page-description">
            Entregas, visitas técnicas e instalações da equipe. A agenda avisa
            quando o mesmo responsável já tem compromisso no horário.
          </p>
        </div>
        <Button className="h-11 px-5" onClick={() => openNew(new Date())}>
          <CalendarPlus className="mr-2 h-4 w-4" />
          Novo agendamento
        </Button>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" aria-label="Semana anterior" onClick={() => shiftWeek(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setReference(new Date())}>Hoje</Button>
            <Button size="icon" variant="outline" aria-label="Próxima semana" onClick={() => shiftWeek(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <p className="ml-2 text-sm font-semibold">{weekLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
            {(["all", "delivery", "technical_visit", "installation"] as const).map(type => (
              <Button key={type} size="sm" variant={typeFilter === type ? "default" : "outline"} aria-pressed={typeFilter === type} onClick={() => setTypeFilter(type)}>
                {type === "all" ? "Todos" : APPOINTMENT_TYPE_LABELS[type]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando agenda…</p>
      ) : error ? (
        <div role="alert" className="space-y-3 py-10 text-center text-sm text-muted-foreground">
          <p>Não foi possível carregar a agenda.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(day => {
            const key = toDateInput(day);
            const items = visible.filter(item => toDateInput(new Date(item.scheduledAt)) === key);
            return (
              <Card key={key} className={`border-border/70 shadow-sm ${key === today ? "ring-1 ring-primary/40" : ""}`}>
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <p className="text-sm font-bold first-letter:uppercase">
                    {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }).format(day)}
                    {key === today ? <Badge className="ml-2">Hoje</Badge> : null}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => openNew(day)} aria-label={`Agendar em ${key}`}>
                    <CalendarPlus className="h-4 w-4" />
                  </Button>
                </div>
                <CardContent className="p-0">
                  {items.length ? (
                    <div className="divide-y divide-border">
                      {items.map(item => {
                        const at = new Date(item.scheduledAt);
                        const end = new Date(at.getTime() + item.durationMinutes * 60_000);
                        const inactive = item.status !== "scheduled";
                        return (
                          <div key={item.id} className={`flex flex-col gap-3 p-4 md:flex-row md:items-center ${inactive ? "opacity-60" : ""}`}>
                            <div className="w-28 shrink-0">
                              <p className="flex items-center gap-1.5 font-display text-base font-bold"><Clock className="h-4 w-4 text-muted-foreground" />{timeOf(at)}</p>
                              <p className="text-xs text-muted-foreground">até {timeOf(end)}</p>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" className={typeStyle[item.type]}>{APPOINTMENT_TYPE_LABELS[item.type]}</Badge>
                                <p className={`text-sm font-bold ${item.status === "cancelled" ? "line-through" : ""}`}>{item.clientName}</p>
                                {item.quoteNumber ? (
                                  <Link href={`/orcamentos/${item.quoteId}`} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline">#{item.quoteNumber}</Link>
                                ) : null}
                                {inactive ? <Badge variant="outline">{APPOINTMENT_STATUS_LABELS[item.status]}</Badge> : null}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                {item.address ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{item.address}</span> : null}
                                {item.responsible ? <span className="flex items-center gap-1"><UserRound className="h-3 w-3" />{item.responsible}</span> : null}
                              </div>
                              {item.notes ? <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p> : null}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {item.status === "scheduled" ? (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: item.id, status: "done" })}><Check className="mr-1.5 h-3.5 w-3.5" />Concluir</Button>
                                  <Button size="icon" variant="ghost" aria-label="Confirmar pelo WhatsApp" title="Confirmar pelo WhatsApp" onClick={() => confirmByWhatsApp(item)}><MessageCircle className="h-4 w-4" /></Button>
                                  <Button size="icon" variant="ghost" aria-label="Editar agendamento" title="Editar" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                                  <Button size="icon" variant="ghost" aria-label="Cancelar agendamento" title="Cancelar" onClick={() => setStatus.mutate({ id: item.id, status: "cancelled" })}><X className="h-4 w-4" /></Button>
                                </>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: item.id, status: "scheduled" })}>Reabrir</Button>
                              )}
                              <Button size="icon" variant="ghost" aria-label="Excluir agendamento" title="Excluir" onClick={() => setPendingDelete(item)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-4 py-3 text-xs text-muted-foreground">Sem compromissos.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {!visible.length ? (
            <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              Nenhum compromisso nesta semana{typeFilter === "all" ? "" : " para este tipo"}.
            </p>
          ) : null}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar agendamento" : "Novo agendamento"}</DialogTitle>
            <DialogDescription>Escolha um orçamento para preencher cliente, telefone e endereço.</DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="appointment-type">Tipo</Label>
              <select id="appointment-type" className={selectClass} value={form.type} onChange={event => setForm({ ...form, type: event.target.value as AppointmentType })}>
                {(Object.keys(APPOINTMENT_TYPE_LABELS) as AppointmentType[]).map(type => <option key={type} value={type}>{APPOINTMENT_TYPE_LABELS[type]}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-quote">Orçamento</Label>
              <select id="appointment-quote" className={selectClass} value={form.quoteId ?? ""} onChange={event => setForm(applyQuote(event.target.value ? Number(event.target.value) : null, form))}>
                <option value="">Sem orçamento</option>
                {selectableQuotes.map(quote => <option key={quote.id} value={quote.id}>#{quote.quoteNumber} · {quote.clientName || "sem cliente"}</option>)}
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="appointment-client">Cliente *</Label>
              <Input id="appointment-client" value={form.clientName} onChange={event => setForm({ ...form, clientName: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-phone">Telefone</Label>
              <Input id="appointment-phone" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-responsible">Responsável</Label>
              <Input id="appointment-responsible" value={form.responsible} onChange={event => setForm({ ...form, responsible: event.target.value })} placeholder="Ex.: equipe de instalação" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="appointment-address">Endereço</Label>
              <Input id="appointment-address" value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-date">Data</Label>
              <Input id="appointment-date" type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="appointment-time">Horário</Label>
                <Input id="appointment-time" type="time" value={form.time} onChange={event => setForm({ ...form, time: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appointment-duration">Duração</Label>
                <select id="appointment-duration" className={selectClass} value={form.durationMinutes} onChange={event => setForm({ ...form, durationMinutes: Number(event.target.value) })}>
                  {durations.map(minutes => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="appointment-notes">Observações</Label>
              <Textarea id="appointment-notes" rows={2} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Ex.: levar escada, cliente pede chegar antes das 10h" />
            </div>
          </div>
          {conflicts.data?.length ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {form.responsible} já tem compromisso neste horário:{" "}
              {conflicts.data.map(item => `${APPOINTMENT_TYPE_LABELS[item.type].toLowerCase()} de ${item.clientName} às ${timeOf(new Date(item.scheduledAt))}`).join("; ")}.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <AsyncButton pending={save.isPending} loadingLabel="Salvando…" onClick={submit}>
              {form.id ? "Salvar alterações" : "Agendar"}
            </AsyncButton>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={value => !value && setPendingDelete(null)}
        title="Excluir este agendamento?"
        description={pendingDelete ? `${APPOINTMENT_TYPE_LABELS[pendingDelete.type]} de ${pendingDelete.clientName}. Para manter o histórico, prefira cancelar.` : ""}
        confirmLabel="Excluir"
        destructive
        onConfirm={() => pendingDelete && remove.mutate({ id: pendingDelete.id })}
      />
    </div>
  );
}
