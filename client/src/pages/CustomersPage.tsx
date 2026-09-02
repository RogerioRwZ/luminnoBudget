import {
  AsyncButton,
  FormError,
  getFormErrorMessage,
} from "@/components/FormFeedback";
import { DraftAutosaveStatus } from "@/components/DraftAutosaveStatus";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
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
import { money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  FileText,
  Plus,
  Search,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
  const { data: quotes = [] } = trpc.quote.list.useQuery();
  const save = trpc.customers.save.useMutation({
    onSuccess: () => {
      utils.customers.list.invalidate();
      setFormError("");
      window.localStorage.removeItem(
        `luminno:draft:customer-${form.id ?? "new"}`
      );
      toast.success("Cliente salvo com sucesso");
      setOpen(false);
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível salvar o cliente. Confira nome e profissional e tente novamente."
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
  const filtered = useMemo(
    () =>
      data.filter(customer =>
        `${customer.name} ${customer.professional}`
          .toLocaleLowerCase("pt-BR")
          .includes(search.toLocaleLowerCase("pt-BR"))
      ),
    [data, search]
  );
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
    if (!value) setForm(emptyCustomer);
  };
  const historyCustomer = data.find(customer => customer.id === historyId);
  const historyQuotes = quotes.filter(quote => quote.clientId === historyId);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Relacionamento</p>
          <h2 className="page-title">Clientes</h2>
          <p className="page-description">
            O cadastro começa apenas com nome e profissional responsável; os
            demais dados são opcionais.
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
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome do cliente *</Label>
                <Input
                  aria-label="Nome do cliente *"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Profissional responsável *</Label>
                <Input
                  aria-label="Profissional responsável *"
                  value={form.professional}
                  onChange={e =>
                    setForm({ ...form, professional: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>CPF/CNPJ</Label>
                <Input
                  aria-label="CPF/CNPJ"
                  value={form.document}
                  onChange={e => setForm({ ...form, document: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  aria-label="Telefone"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>E-mail</Label>
                <Input
                  aria-label="E-mail"
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
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
                onClick={() => save.mutate(form)}
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
              aria-label="Buscar por cliente ou profissional"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por cliente ou profissional"
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
            <div className="divide-y divide-border">
              {filtered.map(customer => (
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
                      Profissional: {customer.professional}
                      {customer.phone ? ` · ${customer.phone}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold">
                      {customer.quoteCount} orçamento(s)
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Histórico de {historyCustomer?.name}</DialogTitle>
          </DialogHeader>
          <div className="mt-2 max-h-[55vh] space-y-2 overflow-y-auto">
            {historyQuotes.length ? (
              historyQuotes.map(quote => (
                <div
                  key={quote.id}
                  className="flex items-center justify-between rounded-xl border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-bold">
                      Orçamento #{quote.quoteNumber}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {quote.status === "approved"
                        ? "Aprovado"
                        : quote.status === "open"
                          ? "Em aberto"
                          : quote.status === "lost"
                            ? "Perdido"
                            : "Rascunho"}
                    </p>
                  </div>
                  <p className="font-display text-sm font-bold">
                    {money(quote.summary.total)}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm font-semibold">
                  Sem orçamentos vinculados.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ao selecionar este cliente no emissor, as próximas propostas
                  aparecerão aqui.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
