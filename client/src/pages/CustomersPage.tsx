import { ShowMoreButton } from "@/components/ShowMoreButton";
import { useVisibleItems } from "@/hooks/useVisibleItems";
import {
  AsyncButton,
  FormError,
  getFormErrorMessage,
} from "@/components/FormFeedback";
import { DraftAutosaveStatus } from "@/components/DraftAutosaveStatus";
import { removeDraft, useDraftAutosave } from "@/hooks/useDraftAutosave";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateOnly, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  FileText,
  MessageCircle,
  Plus,
  Search,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { normalizeWhatsAppPhone } from "@shared/whatsapp";
import { QUOTE_STATUS_LABELS } from "@shared/quoteStatus";
import { plural } from "@shared/plural";
import { DocumentInput, EmailInput, PhoneInput } from "@/components/ContactInputs";
import { contactKey, documentProblem, emailProblem, matchesClientSearch, phoneDigits, phoneProblem } from "@shared/contact";

type CustomerForm = {
  id?: number;
  name: string;
  professional: string;
  document: string;
  stateRegistration: string;
  phone: string;
  email: string;
  address: string;
};
const emptyCustomer: CustomerForm = {
  name: "",
  professional: "",
  document: "",
  stateRegistration: "",
  phone: "",
  email: "",
  address: "",
};

export default function CustomersPage() {
  const utils = trpc.useUtils();
  const {
    data = [],
    isLoading,
    error,
    refetch,
  } = trpc.customers.list.useQuery();
  const [, setLocation] = useLocation();
  const save = trpc.customers.save.useMutation({
    onSuccess: () => {
      utils.customers.list.invalidate();
      setFormError("");
      removeDraft(`customer-${form.id ?? "new"}`);
      toast.success("Cliente salvo com sucesso");
      setOpen(false);
      // Sem limpar, o próximo "Novo cliente" abria com os dados deste.
      setForm(emptyCustomer);
      setTriedSave(false);
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível salvar o cliente. Confira o nome e tente novamente."
      );
      setFormError(message);
      toast.error(message);
    },
  });
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CustomerForm>(emptyCustomer);
  const customerDraft = useDraftAutosave(`customer-${form.id ?? "new"}`, form, {
    enabled: open,
  });
  const filtered = useMemo(() => data.filter(customer => matchesClientSearch(customer, search)), [data, search]);
  const { visible: visibleCustomers, remaining: remainingCustomers, showMore: showMoreCustomers } = useVisibleItems(filtered, filtered.length);
  // Mesmo CPF/CNPJ ou telefone em outro cliente: avisa (sem bloquear; uma
  // família pode dividir o telefone) e oferece abrir o cadastro existente.
  const duplicates = useMemo(() => {
    const documentKey = contactKey(form.document);
    const phoneKey = phoneDigits(form.phone);
    return data
      .filter(customer => customer.id !== form.id)
      .flatMap<{ customer: (typeof data)[number]; by: "document" | "phone" }>(customer =>
        documentKey.length >= 11 && contactKey(customer.document) === documentKey
          ? [{ customer, by: "document" }]
          : phoneKey.length >= 10 && phoneDigits(customer.phone) === phoneKey
            ? [{ customer, by: "phone" }]
            : []
      )
      .slice(0, 3);
  }, [data, form.document, form.phone, form.id]);
  const [triedSave, setTriedSave] = useState(false);
  const submit = () => {
    setTriedSave(true);
    const problem = documentProblem(form.document) ?? phoneProblem(form.phone) ?? emailProblem(form.email);
    if (problem) {
      setFormError(problem);
      return;
    }
    save.mutate(form);
  };
  const edit = (customer: (typeof data)[number]) => {
    setForm({
      id: customer.id,
      name: customer.name,
      professional: customer.professional,
      document: customer.document ?? "",
      stateRegistration: customer.stateRegistration ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
    });
    setOpen(true);
  };
  const close = (value: boolean) => {
    setOpen(value);
    setFormError("");
    setTriedSave(false);
    if (!value) setForm(emptyCustomer);
  };
  const historyCustomer = data.find(customer => customer.id === historyId);
  const statement = trpc.customers.statement.useQuery(
    { id: historyId ?? 0 },
    { enabled: historyId !== null }
  );
  const historyQuotes = statement.data?.quotes ?? [];
  const historyPhone = normalizeWhatsAppPhone(historyCustomer?.phone || "");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Relacionamento</p>
          <h2 className="page-title">Clientes</h2>
          <p className="page-description">
            O cadastro começa apenas com o nome do cliente; os demais dados,
            como o profissional responsável, são opcionais.
          </p>
        </div>
        <Dialog open={open} onOpenChange={close}>
          <DialogTrigger asChild>
            <Button className="h-11 px-5">
              <UserRoundPlus className="mr-2 h-4 w-4" />
              Novo cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                {form.id ? "Editar cliente" : "Novo cliente"}
                <DraftAutosaveStatus status={customerDraft.status} />
              </DialogTitle>
              <DialogDescription className="sr-only">
                Informe os dados do cliente para associá-lo a orçamentos.
              </DialogDescription>
            </DialogHeader>
            <FormError message={formError} />
            {customerDraft.hasRecovery ? (
              <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-semibold">Rascunho local encontrado</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recupere os dados deste cliente ou descarte o rascunho salvo
                  neste dispositivo.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={customerDraft.discard}
                  >
                    Descartar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const restored = customerDraft.restore();
                      if (restored) setForm(restored);
                    }}
                  >
                    Recuperar
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome do cliente *</Label>
                <Input
                  aria-label="Nome do cliente *"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Profissional responsável</Label>
                <Input
                  aria-label="Profissional responsável"
                  value={form.professional}
                  onChange={e =>
                    setForm({ ...form, professional: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-document">CPF/CNPJ</Label>
                <DocumentInput
                  id="customer-document"
                  aria-label="CPF/CNPJ"
                  strict
                  showProblem={triedSave}
                  value={form.document}
                  onValueChange={document => setForm(current => ({ ...current, document }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-phone">Telefone</Label>
                <PhoneInput
                  id="customer-phone"
                  aria-label="Telefone"
                  strict
                  showProblem={triedSave}
                  value={form.phone}
                  onValueChange={phone => setForm(current => ({ ...current, phone }))}
                />
              </div>
              {duplicates.length ? (
                <div role="status" className="space-y-1.5 rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-xs sm:col-span-2">
                  {duplicates.map(({ customer, by }) => (
                    <div key={customer.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Já existe: <b>{customer.name}</b> ({by === "document" ? `CPF/CNPJ ${customer.document}` : `telefone ${customer.phone}`})
                      </span>
                      <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => edit(customer)}>
                        Abrir cadastro
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="customer-email">E-mail</Label>
                <EmailInput
                  id="customer-email"
                  aria-label="E-mail"
                  strict
                  showProblem={triedSave}
                  value={form.email}
                  onValueChange={email => setForm(current => ({ ...current, email }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Endereço</Label>
                <Textarea
                  aria-label="Endereço"
                  rows={2}
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <AsyncButton
                pending={save.isPending}
                loadingLabel="Salvando cliente…"
                onClick={submit}
              >
                Salvar cliente
              </AsyncButton>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="relative border-b border-border p-4">
            <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar por nome, CPF/CNPJ, telefone ou e-mail"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail"
              className="max-w-md pl-9"
            />
          </div>
          {isLoading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Carregando clientes…
            </p>
          ) : error ? (
            <div
              role="alert"
              className="space-y-3 p-8 text-center text-sm text-muted-foreground"
            >
              <p>Não foi possível carregar os clientes.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : filtered.length ? (
            <>
            <div className="divide-y divide-border">
              {visibleCustomers.map(customer => (
                <div
                  key={customer.id}
                  className="flex flex-col gap-3 p-4 transition hover:bg-muted/30 sm:flex-row sm:items-center"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f4d842] font-display text-sm font-bold text-black">
                    {customer.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{customer.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        customer.professional && `Profissional: ${customer.professional}`,
                        customer.phone,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sem profissional ou telefone"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold">
                      {plural(customer.quoteCount, "orçamento", "orçamentos")}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setHistoryId(customer.id)}
                    >
                      <FileText className="mr-1.5 h-3.5 w-3.5" />
                      Histórico
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => edit(customer)}
                    >
                      Editar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <ShowMoreButton remaining={remainingCustomers} onClick={showMoreCustomers} />
            </>
          ) : (
            <div className="p-12 text-center">
              <UsersRound className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-bold">
                Nenhum cliente cadastrado.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Adicione o primeiro contato para associá-lo às propostas.
              </p>
              <Button className="mt-5" size="sm" onClick={() => setOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Cadastrar cliente
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={historyId !== null}
        onOpenChange={value => !value && setHistoryId(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Ficha de {historyCustomer?.name}</DialogTitle>
            <DialogDescription>
              Orçamentos vinculados e situação financeira do cliente.
            </DialogDescription>
          </DialogHeader>
          {historyPhone ? (
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a
                href={`https://wa.me/${historyPhone}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                Conversar no WhatsApp
              </a>
            </Button>
          ) : null}
          {statement.isLoading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Carregando ficha do cliente…
            </p>
          ) : statement.error ? (
            <div
              role="alert"
              className="space-y-3 p-6 text-center text-sm text-muted-foreground"
            >
              <p>Não foi possível carregar a ficha do cliente.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => statement.refetch()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: "Orçado ativo", value: money(statement.data?.totals.quoted) },
                  { label: "Aprovado", value: money(statement.data?.totals.approved) },
                  {
                    label: "Conversão",
                    value:
                      statement.data?.totals.conversionRate == null
                        ? "—"
                        : `${Math.round(statement.data.totals.conversionRate * 100)}%`,
                  },
                  { label: "Recebido", value: money(statement.data?.totals.received) },
                  { label: "A receber", value: money(statement.data?.totals.outstanding) },
                  { label: "Em atraso", value: money(statement.data?.totals.overdue) },
                ].map(entry => (
                  <div key={entry.label} className="rounded-xl bg-muted/60 px-3 py-2">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {entry.label}
                    </dt>
                    <dd className="mt-1 text-sm font-bold">{entry.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2 max-h-[45vh] space-y-2 overflow-y-auto">
                {historyQuotes.length ? (
                  historyQuotes.map(quote => (
                    <button
                      type="button"
                      key={quote.id}
                      onClick={() => setLocation(`/orcamentos/${quote.id}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border p-3 text-left transition hover:bg-muted/40"
                    >
                      <div>
                        <p className="text-sm font-bold">
                          Orçamento #{quote.quoteNumber}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {QUOTE_STATUS_LABELS[quote.status]}{" "}
                          · {dateOnly(quote.issueDate)}
                        </p>
                      </div>
                      <span className="flex items-center gap-2 font-display text-sm font-bold">
                        {money(quote.total)}
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <p className="text-sm font-semibold">
                      Sem orçamentos vinculados.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ao selecionar este cliente no emissor, as próximas
                      propostas aparecerão aqui.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
