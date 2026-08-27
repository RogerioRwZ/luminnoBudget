import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { FinanceStatus, PaymentMethod, PaymentType } from "@shared/finance";
import {
  Banknote,
  CalendarClock,
  CircleDollarSign,
  Landmark,
  Plus,
  RotateCcw,
  Search,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const nowInput = () => new Date().toISOString().slice(0, 16);
const dateInput = () => new Date().toISOString().slice(0, 10);
const statusMeta: Record<FinanceStatus, { label: string; className: string }> =
  {
    open: { label: "Em aberto", className: "bg-sky-500/10 text-sky-700" },
    partial: { label: "Parcial", className: "bg-amber-500/15 text-amber-800" },
    paid: {
      label: "Recebida",
      className: "bg-emerald-500/10 text-emerald-700",
    },
    overdue: { label: "Vencida", className: "bg-red-500/10 text-red-700" },
    cancelled: {
      label: "Cancelada",
      className: "bg-slate-500/10 text-slate-700",
    },
  };
const paymentLabels: Record<PaymentMethod, string> = {
  pix: "PIX",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  bank_transfer: "Transferência",
  boleto: "Boleto",
  other: "Outro",
};
type Receivable = {
  id: number;
  quoteId: number | null;
  quoteNumber: number | null;
  clientId: number | null;
  clientName: string;
  description: string;
  installmentNumber: number;
  installmentCount: number;
  originalAmount: number;
  dueDate: Date;
  status: FinanceStatus;
  receivedAmount: number;
  remainingAmount: number;
  overdue: boolean;
  payments: Array<{
    id: number;
    type: PaymentType;
    amount: number;
    paymentMethod: PaymentMethod;
    paidAt: Date;
    reference: string | null;
    notes: string | null;
  }>;
};

export default function FinancePage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data, isLoading, error, refetch } = trpc.finance.overview.useQuery();
  const { data: clients = [] } = trpc.finance.clients.useQuery();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FinanceStatus>(
    "all"
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Receivable | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    clientId: "",
    clientName: "",
    description: "",
    totalAmount: "",
    installmentCount: "1",
    firstDueDate: dateInput(),
  });
  const [paymentForm, setPaymentForm] = useState({
    type: "receipt" as PaymentType,
    amount: "",
    paymentMethod: "pix" as PaymentMethod,
    paidAt: nowInput(),
    reference: "",
    notes: "",
  });
  const refresh = () => {
    utils.finance.invalidate();
    utils.dashboard.invalidate();
  };
  const create = trpc.finance.create.useMutation({
    onSuccess: ids => {
      refresh();
      setCreateOpen(false);
      setCreateForm({
        clientId: "",
        clientName: "",
        description: "",
        totalAmount: "",
        installmentCount: "1",
        firstDueDate: dateInput(),
      });
      toast.success(`${ids.length} cobrança(s) criada(s).`);
    },
    onError: error => toast.error(error.message),
  });
  const recordPayment = trpc.finance.recordPayment.useMutation({
    onSuccess: result => {
      refresh();
      setPaymentOpen(false);
      setSelected(null);
      toast.success(
        result.status === "paid"
          ? "Cobrança quitada."
          : "Movimentação registrada."
      );
    },
    onError: error => toast.error(error.message),
  });
  const cancel = trpc.finance.cancel.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Cobrança cancelada.");
    },
    onError: error => toast.error(error.message),
  });
  const rows = (data?.receivables ?? []) as Receivable[];
  const totals = data?.totals;
  const filtered = useMemo(
    () =>
      rows.filter(
        row =>
          (statusFilter === "all" || row.status === statusFilter) &&
          `${row.clientName} ${row.description} ${row.quoteNumber ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(search.toLocaleLowerCase("pt-BR"))
      ),
    [rows, search, statusFilter]
  );
  const selectClient = (id: string) => {
    const client = clients.find(item => item.id === Number(id));
    setCreateForm({
      ...createForm,
      clientId: id,
      clientName: client?.name ?? createForm.clientName,
    });
  };
  const openPayment = (row: Receivable, type: PaymentType = "receipt") => {
    setSelected(row);
    setPaymentForm({
      type,
      amount:
        type === "receipt"
          ? row.remainingAmount.toFixed(2)
          : row.receivedAmount.toFixed(2),
      paymentMethod: "pix",
      paidAt: nowInput(),
      reference: "",
      notes: "",
    });
    setPaymentOpen(true);
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Contas a receber</p>
          <h2 className="page-title">Financeiro</h2>
          <p className="page-description">
            Acompanhe vencimentos, parcelas, recebimentos parciais, estornos e
            saldos dos orçamentos aprovados.
          </p>
        </div>
        <Button className="h-11 px-5" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova cobrança
        </Button>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <CircleDollarSign className="h-5 w-5 text-primary" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              A receber
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {money(totals?.outstanding)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <Banknote className="h-5 w-5 text-emerald-600" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Recebido no mês
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {money(totals?.receivedThisMonth)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <CalendarClock className="h-5 w-5 text-red-600" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Em atraso
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {money(totals?.overdueAmount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals?.overdueCount ?? 0} cobrança(s)
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <Landmark className="h-5 w-5 text-sky-600" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Previsto em carteira
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {money(totals?.expected)}
            </p>
          </CardContent>
        </Card>
      </section>
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="font-display text-lg">
              Cobranças e parcelas
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              As parcelas de orçamentos aprovados entram automaticamente na
              carteira uma única vez.
            </p>
          </div>
          <WalletCards className="h-5 w-5 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="mb-5 grid gap-3 rounded-xl bg-muted/50 p-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar cliente, orçamento ou descrição"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar cliente, orçamento ou descrição"
                className="h-10 pl-9"
              />
            </div>
            <select
              aria-label="Filtrar cobranças por status"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={event =>
                setStatusFilter(event.target.value as typeof statusFilter)
              }
            >
              <option value="all">Todos os status</option>
              <option value="open">Em aberto</option>
              <option value="partial">Parcial</option>
              <option value="overdue">Vencidas</option>
              <option value="paid">Recebidas</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </div>
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Carregando financeiro…
            </p>
          ) : error ? (
            <div
              role="alert"
              className="space-y-3 py-10 text-center text-sm text-muted-foreground"
            >
              <p>Não foi possível carregar as cobranças.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : filtered.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-3">Cliente / origem</th>
                    <th className="pb-3">Vencimento</th>
                    <th className="pb-3">Parcela</th>
                    <th className="pb-3 text-right">Valor</th>
                    <th className="pb-3 text-right">Recebido</th>
                    <th className="pb-3 text-right">Saldo</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => {
                    const meta = statusMeta[row.status];
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border/70 last:border-0"
                      >
                        <td className="py-4">
                          <p className="font-semibold">{row.clientName}</p>
                          <p className="max-w-[200px] truncate text-xs text-muted-foreground">
                            {row.description}
                            {row.quoteNumber
                              ? ` · Orçamento #${row.quoteNumber}`
                              : ""}
                          </p>
                        </td>
                        <td className="py-4 text-xs">
                          {new Intl.DateTimeFormat("pt-BR").format(
                            new Date(row.dueDate)
                          )}
                        </td>
                        <td className="py-4 text-xs">
                          {row.installmentNumber}/{row.installmentCount}
                        </td>
                        <td className="py-4 text-right font-semibold">
                          {money(row.originalAmount)}
                        </td>
                        <td className="py-4 text-right text-emerald-700">
                          {money(row.receivedAmount)}
                        </td>
                        <td className="py-4 text-right font-semibold">
                          {money(row.remainingAmount)}
                        </td>
                        <td className="py-4">
                          <Badge variant="secondary" className={meta.className}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="py-4">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                row.status === "paid" ||
                                row.status === "cancelled"
                              }
                              onClick={() => openPayment(row)}
                            >
                              {row.receivedAmount > 0
                                ? "Receber saldo"
                                : "Receber"}
                            </Button>
                            {row.receivedAmount > 0 &&
                            row.status !== "cancelled" ? (
                              <Button
                                aria-label="Registrar estorno"
                                size="sm"
                                variant="outline"
                                onClick={() => openPayment(row, "reversal")}
                                title="Registrar estorno"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                            {row.status !== "cancelled" &&
                            row.receivedAmount === 0 ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={cancel.isPending}
                                onClick={() => cancel.mutate({ id: row.id })}
                              >
                                Cancelar
                              </Button>
                            ) : null}
                            {row.quoteId ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setLocation(`/orcamentos/${row.quoteId}`)
                                }
                              >
                                Abrir
                              </Button>
                            ) : null}
                          </div>
                          {row.payments.length ? (
                            <details className="mt-2 text-right text-xs text-muted-foreground">
                              <summary className="cursor-pointer">
                                {row.payments.length} movimentação(ões)
                              </summary>
                              <div className="mt-1 rounded-lg bg-muted/50 p-2 text-left">
                                {row.payments.map(payment => (
                                  <p key={payment.id}>
                                    {payment.type === "receipt"
                                      ? "Recebimento"
                                      : "Estorno"}
                                    : {money(payment.amount)} ·{" "}
                                    {paymentLabels[payment.paymentMethod]} ·{" "}
                                    {new Intl.DateTimeFormat("pt-BR").format(
                                      new Date(payment.paidAt)
                                    )}
                                  </p>
                                ))}
                              </div>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <WalletCards className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">
                Nenhuma cobrança encontrada.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Aprove um orçamento ou crie uma cobrança avulsa para iniciar o
                controle financeiro.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova cobrança</DialogTitle>
            <DialogDescription>
              Crie uma conta a receber avulsa ou divida o valor em parcelas
              mensais.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Cliente cadastrado</Label>
              <select
                aria-label="Cliente cadastrado"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={createForm.clientId}
                onChange={event => selectClient(event.target.value)}
              >
                <option value="">Selecionar depois</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name} · {client.professional}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Nome do cliente</Label>
              <Input
                aria-label="Nome do cliente"
                value={createForm.clientName}
                onChange={event =>
                  setCreateForm({
                    ...createForm,
                    clientName: event.target.value,
                  })
                }
                placeholder="Obrigatório se não selecionar um cliente"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                aria-label="Descrição"
                value={createForm.description}
                onChange={event =>
                  setCreateForm({
                    ...createForm,
                    description: event.target.value,
                  })
                }
                placeholder="Ex.: sinal de projeto"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>Valor total</Label>
                <Input
                  aria-label="Valor total"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={createForm.totalAmount}
                  onChange={event =>
                    setCreateForm({
                      ...createForm,
                      totalAmount: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Parcelas</Label>
                <Input
                  aria-label="Parcelas"
                  type="number"
                  min="1"
                  max="24"
                  value={createForm.installmentCount}
                  onChange={event =>
                    setCreateForm({
                      ...createForm,
                      installmentCount: event.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>1º vencimento</Label>
              <Input
                aria-label="1º vencimento"
                type="date"
                value={createForm.firstDueDate}
                onChange={event =>
                  setCreateForm({
                    ...createForm,
                    firstDueDate: event.target.value,
                  })
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={
                create.isPending ||
                !createForm.clientName ||
                !createForm.description ||
                Number(createForm.totalAmount) <= 0
              }
              onClick={() =>
                create.mutate({
                  quoteId: null,
                  clientId: createForm.clientId
                    ? Number(createForm.clientId)
                    : null,
                  clientName: createForm.clientName,
                  description: createForm.description,
                  totalAmount: Number(createForm.totalAmount),
                  installmentCount: Number(createForm.installmentCount),
                  firstDueDate: new Date(`${createForm.firstDueDate}T12:00:00`),
                })
              }
            >
              Criar cobrança
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={paymentOpen}
        onOpenChange={open => {
          setPaymentOpen(open);
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {paymentForm.type === "receipt"
                ? "Registrar recebimento"
                : "Registrar estorno"}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.clientName} · saldo atual ${money(selected.remainingAmount)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <select
                  aria-label="Tipo de movimentação"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={paymentForm.type}
                  onChange={event =>
                    setPaymentForm({
                      ...paymentForm,
                      type: event.target.value as PaymentType,
                    })
                  }
                >
                  <option value="receipt">Recebimento</option>
                  <option value="reversal">Estorno</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Valor</Label>
                <Input
                  aria-label="Valor"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={event =>
                    setPaymentForm({
                      ...paymentForm,
                      amount: event.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <select
                aria-label="Forma de pagamento"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={paymentForm.paymentMethod}
                onChange={event =>
                  setPaymentForm({
                    ...paymentForm,
                    paymentMethod: event.target.value as PaymentMethod,
                  })
                }
              >
                {(Object.keys(paymentLabels) as PaymentMethod[]).map(method => (
                  <option key={method} value={method}>
                    {paymentLabels[method]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Data e hora</Label>
              <Input
                aria-label="Data e hora"
                type="datetime-local"
                value={paymentForm.paidAt}
                onChange={event =>
                  setPaymentForm({ ...paymentForm, paidAt: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Referência</Label>
              <Input
                aria-label="Referência"
                value={paymentForm.reference}
                onChange={event =>
                  setPaymentForm({
                    ...paymentForm,
                    reference: event.target.value,
                  })
                }
                placeholder="Ex.: NSU, recibo ou identificação PIX"
              />
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea
                aria-label="Observação"
                rows={2}
                value={paymentForm.notes}
                onChange={event =>
                  setPaymentForm({ ...paymentForm, notes: event.target.value })
                }
                placeholder="Informação interna"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={
                recordPayment.isPending ||
                !selected ||
                Number(paymentForm.amount) <= 0
              }
              onClick={() =>
                selected &&
                recordPayment.mutate({
                  receivableId: selected.id,
                  type: paymentForm.type,
                  amount: Number(paymentForm.amount),
                  paymentMethod: paymentForm.paymentMethod,
                  paidAt: new Date(paymentForm.paidAt),
                  reference: paymentForm.reference || null,
                  notes: paymentForm.notes || null,
                })
              }
            >
              {paymentForm.type === "receipt"
                ? "Registrar recebimento"
                : "Confirmar estorno"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
