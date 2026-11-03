import { AsyncButton, FormError, getFormErrorMessage } from "@/components/FormFeedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dateOnly, formatDateInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { ScanButton } from "@/components/CameraBarcodeScanner";
import { useUnknownCode } from "@/hooks/useUnknownCode";
import { BORROWER_KIND_LABELS, BORROWER_KINDS, type BorrowerKind } from "@shared/loans";
import { canOpenPage } from "@shared/permissions";
import { plural } from "@shared/plural";
import { AlertTriangle, CalendarClock, Lightbulb, PackageOpen, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { PhoneInput } from "@/components/ContactInputs";

type NewLine = { productId: number; label: string; unit: string; stock: number; quantity: string };
type NewForm = { borrowerName: string; borrowerKind: BorrowerKind; phone: string; dueDate: string; notes: string; responsible: string; lines: NewLine[] };
type SettleLine = { itemId: number; returned: string; sold: string; lost: string };
type SettleForm = { loanId: number; lines: SettleLine[]; quoteNumber: string; notes: string; responsible: string };

const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
};
const fromDateInput = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const num = (value: string) => Number(value.replace(",", ".")) || 0;
const quantityText = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const emptyNew = (): NewForm => ({ borrowerName: "", borrowerKind: "professional", phone: "", dueDate: inDays(7), notes: "", responsible: "", lines: [] });

export default function LoansPage() {
  const utils = trpc.useUtils();
  const unknownCode = useUnknownCode();
  const { data: me } = trpc.auth.me.useQuery();
  const canOpenQuote = canOpenPage(me?.role, "/orcamentos");
  const loans = trpc.loans.list.useQuery();
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState("");
  const [newForm, setNewForm] = useState<NewForm | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [settleForm, setSettleForm] = useState<SettleForm | null>(null);
  const [extendForm, setExtendForm] = useState<{ loanId: number; dueDate: string } | null>(null);
  const [formError, setFormError] = useState("");
  const productSearch = trpc.product.list.useQuery({ search: productQuery.trim() }, { enabled: Boolean(newForm) && productQuery.trim().length >= 2 });

  const refresh = () => {
    utils.loans.invalidate();
    utils.inventory.invalidate();
    utils.summary.today.invalidate();
  };
  const create = trpc.loans.create.useMutation({
    onSuccess: loan => {
      refresh();
      setNewForm(null);
      toast.success(`Empréstimo #${loan.id} registrado. As peças saíram do estoque.`);
    },
    onError: err => setFormError(getFormErrorMessage(err, "Não foi possível registrar o empréstimo.")),
  });
  const settle = trpc.loans.settle.useMutation({
    onSuccess: loan => {
      refresh();
      setSettleForm(null);
      toast.success(loan.open ? "Acerto registrado." : `Empréstimo #${loan.id} encerrado.`);
    },
    onError: err => setFormError(getFormErrorMessage(err, "Não foi possível registrar o acerto.")),
  });
  const extend = trpc.loans.extend.useMutation({
    onSuccess: () => {
      refresh();
      setExtendForm(null);
      toast.success("Prazo de devolução atualizado.");
    },
    onError: err => setFormError(getFormErrorMessage(err, "Não foi possível mudar o prazo.")),
  });

  const rows = loans.data ?? [];
  const term = query.trim().toLocaleLowerCase("pt-BR");
  const visible = rows.filter(loan =>
    (showClosed || loan.open)
    && (!term || [loan.borrowerName, `#${loan.id}`, ...loan.items.map(item => item.shortDescription)].some(value => value.toLocaleLowerCase("pt-BR").includes(term))));
  const open = rows.filter(loan => loan.open);
  const settling = settleForm ? rows.find(loan => loan.id === settleForm.loanId) : undefined;
  const settleSold = settleForm ? settleForm.lines.reduce((sum, line) => sum + num(line.sold), 0) : 0;

  const addProduct = (product: { id: number; shortDescription: string; unit: string; stockQuantity: string | number }) => {
    if (!newForm || newForm.lines.some(line => line.productId === product.id)) return;
    setNewForm({ ...newForm, lines: [...newForm.lines, { productId: product.id, label: product.shortDescription, unit: product.unit, stock: Number(product.stockQuantity), quantity: "1" }] });
    setProductQuery("");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Operação e expedição</p>
          <h2 className="page-title">Mostruário e consignação</h2>
          <p className="page-description">
            Peças emprestadas para o cliente ou o arquiteto testar na obra. Elas
            saem do estoque sem virar venda e, no acerto, voltam, viram venda ou
            são dadas como perdidas.
          </p>
        </div>
        <Button onClick={() => { setFormError(""); setProductQuery(""); setNewForm(emptyNew()); }}>
          <Plus className="mr-2 h-4 w-4" />
          Novo empréstimo
        </Button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {[
          { label: "Empréstimos abertos", value: loans.isLoading ? "—" : String(open.length), icon: Lightbulb },
          { label: "Peças fora da loja", value: loans.isLoading ? "—" : quantityText(open.reduce((sum, loan) => sum + loan.pending, 0)), icon: PackageOpen },
          { label: "Devolução atrasada", value: loans.isLoading ? "—" : String(open.filter(loan => loan.overdue).length), icon: AlertTriangle, alert: open.some(loan => loan.overdue) },
        ].map(card => (
          <Card key={card.label} className="border-border/70 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <card.icon className={`mb-3 h-5 w-5 ${card.alert ? "text-red-600" : "text-primary"}`} />
              <p className="text-xs font-semibold text-muted-foreground">{card.label}</p>
              <p className={`mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl ${card.alert ? "text-red-700 dark:text-red-300" : ""}`}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar por pessoa, produto ou número" value={query} onChange={event => setQuery(event.target.value)} />
            </div>
            <div className="flex gap-2" role="group" aria-label="Situação">
              <Button size="sm" variant={showClosed ? "outline" : "default"} onClick={() => setShowClosed(false)}>Abertos</Button>
              <Button size="sm" variant={showClosed ? "default" : "outline"} onClick={() => setShowClosed(true)}>Todos</Button>
            </div>
          </div>
          {loans.error ? (
            <div role="alert" className="p-6 text-center text-sm">
              Não foi possível carregar o mostruário.{" "}
              <Button size="sm" variant="outline" onClick={() => loans.refetch()}>Tentar novamente</Button>
            </div>
          ) : visible.length ? (
            <ul className="divide-y divide-border">
              {visible.map(loan => (
                <li key={loan.id} className="flex flex-col gap-3 p-4 lg:flex-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">Empréstimo #{loan.id} · {loan.borrowerName}</span>
                      <Badge variant="outline">{BORROWER_KIND_LABELS[loan.borrowerKind]}</Badge>
                      {loan.open ? null : <Badge variant="outline" className="bg-muted text-muted-foreground">Encerrado</Badge>}
                      {loan.overdue ? <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300">Devolução atrasada</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Saiu em {dateOnly(loan.loanedAt)}
                      {loan.open ? <> · devolver até <b className={loan.overdue ? "text-red-700 dark:text-red-300" : "text-foreground"}>{dateOnly(loan.dueDate)}</b></> : loan.closedAt ? <> · encerrado em {dateOnly(loan.closedAt)}</> : null}
                      {loan.phone ? <> · {loan.phone}</> : null}
                      {loan.quoteNumber ? <> · {canOpenQuote ? <Link href={`/orcamentos/${loan.quoteId}`} className="font-semibold text-primary hover:underline">orçamento #{loan.quoteNumber}</Link> : <>orçamento #{loan.quoteNumber}</>}</> : null}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {loan.items.map(item => (
                        <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                          <span><b>{quantityText(item.quantity)}</b> × {item.shortDescription}</span>
                          <span className="text-xs text-muted-foreground">
                            {[
                              item.pending ? `${quantityText(item.pending)} com a pessoa` : "",
                              item.returnedQuantity ? `${quantityText(item.returnedQuantity)} voltou` : "",
                              item.soldQuantity ? `${quantityText(item.soldQuantity)} vendido` : "",
                              item.lostQuantity ? `${quantityText(item.lostQuantity)} perdido` : "",
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {loan.notes ? <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{loan.notes}</p> : null}
                  </div>
                  {loan.open ? (
                    <div className="flex shrink-0 gap-2 lg:flex-col">
                      <Button size="sm" onClick={() => { setFormError(""); setSettleForm({ loanId: loan.id, quoteNumber: "", notes: "", responsible: "", lines: loan.items.filter(item => item.pending > 0).map(item => ({ itemId: item.id, returned: String(item.pending), sold: "0", lost: "0" })) }); }}>
                        Acertar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setFormError(""); setExtendForm({ loanId: loan.id, dueDate: formatDateInput(loan.dueDate) }); }}>
                        <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                        Prorrogar
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {loans.isLoading ? "Carregando…" : rows.length ? "Nenhum empréstimo com esse filtro." : "Nenhuma peça emprestada. Use \"Novo empréstimo\" quando um cliente ou arquiteto levar amostras para testar."}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(newForm)} onOpenChange={value => !value && setNewForm(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Novo empréstimo</DialogTitle>
            <DialogDescription>As peças saem do estoque agora e voltam no acerto. Peças reservadas para pedidos aprovados não podem ser emprestadas.</DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          {newForm ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="loan-borrower">Com quem fica</Label>
                  <Input id="loan-borrower" placeholder="Nome do cliente ou do escritório" value={newForm.borrowerName} onChange={event => setNewForm({ ...newForm, borrowerName: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={newForm.borrowerKind} onValueChange={value => setNewForm({ ...newForm, borrowerKind: value as BorrowerKind })}>
                    <SelectTrigger className="sm:w-40" aria-label="Tipo"><SelectValue /></SelectTrigger>
                    <SelectContent>{BORROWER_KINDS.map(kind => <SelectItem key={kind} value={kind}>{BORROWER_KIND_LABELS[kind]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loan-phone">Telefone</Label>
                  <PhoneInput id="loan-phone" value={newForm.phone} onValueChange={phone => setNewForm(current => (current ? { ...current, phone } : current))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loan-due">Devolver até</Label>
                  <Input id="loan-due" type="date" value={newForm.dueDate} onChange={event => setNewForm({ ...newForm, dueDate: event.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loan-product">Peças</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="loan-product" className="pl-9" placeholder="Referência, descrição ou código de barras" value={productQuery} onChange={event => setProductQuery(event.target.value)} />
                  </div>
                  <ScanButton
                    title="Adicionar peça pelo código de barras"
                    onDetected={async value => {
                      const product = await utils.product.findByBarcode.fetch({ barcode: value }).catch(() => null);
                      if (product?.active) addProduct(product);
                      else if (product) toast.error(`${product.shortDescription} está arquivado no catálogo.`);
                      else {
                        setProductQuery(value);
                        unknownCode(value);
                      }
                    }}
                  />
                </div>
                {productQuery.trim().length >= 2 ? (
                  <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
                    {(productSearch.data ?? []).filter(product => product.active && !product.isModel).slice(0, 20).map(product => (
                      <li key={product.id}>
                        <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/60" onClick={() => addProduct(product)}>
                          <span className="min-w-0">
                            <span className="block truncate">{product.shortDescription}</span>
                            <span className="block font-mono text-[11px] text-muted-foreground">Ref. {product.reference ?? product.code}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">saldo {quantityText(Number(product.stockQuantity))} {product.unit}</span>
                        </button>
                      </li>
                    ))}
                    {productSearch.data && !productSearch.data.length ? <li className="px-3 py-3 text-center text-xs text-muted-foreground">Nenhum produto encontrado.</li> : null}
                  </ul>
                ) : null}
                {newForm.lines.length ? (
                  <ul className="space-y-2">
                    {newForm.lines.map((line, index) => (
                      <li key={line.productId} className="flex items-center gap-2 rounded-xl border border-border p-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{line.label}<span className="block text-xs text-muted-foreground">saldo {quantityText(line.stock)} {line.unit}</span></span>
                        <Input aria-label={`Quantidade de ${line.label}`} className="w-20" type="number" min="0.01" step="1" value={line.quantity} onChange={event => setNewForm({ ...newForm, lines: newForm.lines.map((entry, position) => (position === index ? { ...entry, quantity: event.target.value } : entry)) })} />
                        <Button size="icon" variant="ghost" aria-label={`Remover ${line.label}`} onClick={() => setNewForm({ ...newForm, lines: newForm.lines.filter((_, position) => position !== index) })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-muted-foreground">Busque e escolha as peças que vão sair.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loan-notes">Observações</Label>
                <Textarea id="loan-notes" rows={2} placeholder="Obra, endereço, combinado sobre avarias…" value={newForm.notes} onChange={event => setNewForm({ ...newForm, notes: event.target.value })} />
              </div>
              <Input placeholder="Quem entregou (opcional)" value={newForm.responsible} onChange={event => setNewForm({ ...newForm, responsible: event.target.value })} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setNewForm(null)}>Cancelar</Button>
                <AsyncButton
                  pending={create.isPending}
                  loadingLabel="Registrando…"
                  disabled={!newForm.borrowerName.trim() || !newForm.lines.length || !newForm.dueDate || newForm.lines.some(line => !(num(line.quantity) > 0))}
                  onClick={() => create.mutate({
                    borrowerName: newForm.borrowerName,
                    borrowerKind: newForm.borrowerKind,
                    phone: newForm.phone || null,
                    dueDate: fromDateInput(newForm.dueDate),
                    notes: newForm.notes || null,
                    responsible: newForm.responsible || null,
                    items: newForm.lines.map(line => ({ productId: line.productId, quantity: num(line.quantity) })),
                  })}
                >
                  Registrar empréstimo
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(settleForm)} onOpenChange={value => !value && setSettleForm(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Acertar empréstimo #{settleForm?.loanId}</DialogTitle>
            <DialogDescription>
              {settling ? `${settling.borrowerName}. ` : ""}O que voltou entra de novo no estoque. O que virou venda também volta ao saldo, para ser reservado e retirado pelo orçamento. O que se perdeu só fica registrado.
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          {settleForm && settling ? (
            <div className="space-y-3">
              {settleForm.lines.map((line, index) => {
                const item = settling.items.find(entry => entry.id === line.itemId)!;
                const update = (key: "returned" | "sold" | "lost", value: string) => setSettleForm({ ...settleForm, lines: settleForm.lines.map((entry, position) => (position === index ? { ...entry, [key]: value } : entry)) });
                return (
                  <div key={line.itemId} className="rounded-xl border border-border p-3">
                    <p className="text-sm font-semibold">{item.shortDescription}</p>
                    <p className="text-xs text-muted-foreground">{quantityText(item.pending)} {item.unit} com a pessoa</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {([["returned", "Voltou"], ["sold", "Vendido"], ["lost", "Perdido"]] as const).map(([key, label]) => (
                        <div key={key} className="space-y-1">
                          <Label htmlFor={`settle-${line.itemId}-${key}`} className="text-xs">{label}</Label>
                          <Input id={`settle-${line.itemId}-${key}`} type="number" min="0" step="1" value={line[key]} onChange={event => update(key, event.target.value)} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {settleSold > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="settle-quote">Nº do orçamento da venda (opcional)</Label>
                  <Input id="settle-quote" inputMode="numeric" placeholder="Ex.: 42" value={settleForm.quoteNumber} onChange={event => setSettleForm({ ...settleForm, quoteNumber: event.target.value.replace(/\D/g, "") })} />
                  <p className="text-xs text-muted-foreground">Aprove o orçamento e registre a retirada normalmente: a peça já voltou ao saldo para isso.</p>
                </div>
              ) : null}
              <Input placeholder="Quem recebeu (opcional)" value={settleForm.responsible} onChange={event => setSettleForm({ ...settleForm, responsible: event.target.value })} />
              <Textarea rows={2} placeholder="Observação do acerto (opcional)" value={settleForm.notes} onChange={event => setSettleForm({ ...settleForm, notes: event.target.value })} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSettleForm(null)}>Cancelar</Button>
                <AsyncButton
                  pending={settle.isPending}
                  loadingLabel="Registrando…"
                  onClick={() => settle.mutate({
                    loanId: settleForm.loanId,
                    quoteNumber: settleForm.quoteNumber ? Number(settleForm.quoteNumber) : null,
                    notes: settleForm.notes || null,
                    responsible: settleForm.responsible || null,
                    lines: settleForm.lines.map(line => ({ itemId: line.itemId, returned: num(line.returned), sold: num(line.sold), lost: num(line.lost) })),
                  })}
                >
                  Registrar acerto
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(extendForm)} onOpenChange={value => !value && setExtendForm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Prorrogar devolução</DialogTitle>
            <DialogDescription>Novo prazo para as peças voltarem.</DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          {extendForm ? (
            <div className="space-y-3">
              <Input type="date" aria-label="Nova data de devolução" value={extendForm.dueDate} onChange={event => setExtendForm({ ...extendForm, dueDate: event.target.value })} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setExtendForm(null)}>Cancelar</Button>
                <AsyncButton pending={extend.isPending} loadingLabel="Salvando…" disabled={!extendForm.dueDate} onClick={() => extend.mutate({ loanId: extendForm.loanId, dueDate: fromDateInput(extendForm.dueDate) })}>
                  Salvar
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {open.length ? <p className="text-xs text-muted-foreground">{plural(open.length, "empréstimo aberto", "empréstimos abertos")}; os com devolução até hoje aparecem no Resumo do dia.</p> : null}
    </div>
  );
}
