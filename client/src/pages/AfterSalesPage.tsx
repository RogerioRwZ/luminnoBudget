import { AsyncButton, FormError, getFormErrorMessage } from "@/components/FormFeedback";
import { isValidPeriod, PeriodPicker, periodRange, presetPeriod, type Period } from "@/components/PeriodPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv } from "@/lib/csvDownload";
import { dateOnly, formatDateInput, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  AFTER_SALES_REASON_LABELS,
  AFTER_SALES_REASONS,
  AFTER_SALES_STATUS_LABELS,
  AFTER_SALES_STATUSES,
  AFTER_SALES_TYPE_LABELS,
  AFTER_SALES_TYPES,
  type AfterSalesReason,
  type AfterSalesStatus,
  type AfterSalesType,
} from "@shared/afterSales";
import { canOpenPage } from "@shared/permissions";
import { plural } from "@shared/plural";
import { AlertTriangle, CheckCircle2, Clock3, FileSpreadsheet, LifeBuoy, Plus, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useSearch } from "wouter";

type StatusFilter = "active" | "all" | AfterSalesStatus;
type NewForm = { quoteId: number | null; quoteItemId: number | null; type: AfterSalesType; reason: AfterSalesReason; quantity: string; dueDate: string; description: string };
type EditForm = {
  id: number;
  status: AfterSalesStatus;
  dueDate: string;
  description: string;
  resolution: string;
  refundAmount: string;
  restock: boolean;
  replacement: boolean;
  responsible: string;
};

const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
};
// Data do campo (aaaa-mm-dd) ao meio-dia local, para não virar o dia anterior em UTC.
const fromDateInput = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const quantityText = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const emptyNew = (quoteId: number | null = null): NewForm => ({ quoteId, quoteItemId: null, type: "exchange", reason: "defect", quantity: "1", dueDate: inDays(7), description: "" });

const STATUS_STYLES: Record<AfterSalesStatus, string> = {
  open: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  supplier: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  resolved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  rejected: "border-border bg-muted text-muted-foreground",
};

export default function AfterSalesPage() {
  const search = useSearch();
  const utils = trpc.useUtils();
  const { data: me } = trpc.auth.me.useQuery();
  const canOpenQuote = canOpenPage(me?.role, "/orcamentos");
  const [tab, setTab] = useState<"cases" | "report">("cases");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>(() => presetPeriod("last_3_months"));
  const validPeriod = isValidPeriod(period);
  const range = useMemo(() => (validPeriod ? periodRange(period) : null), [period, validPeriod]);

  const cases = trpc.afterSales.list.useQuery();
  const report = trpc.afterSales.report.useQuery(range!, { enabled: Boolean(range) });
  const [newForm, setNewForm] = useState<NewForm | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [formError, setFormError] = useState("");
  const [saleQuery, setSaleQuery] = useState("");
  const sales = trpc.afterSales.sales.useQuery(undefined, { enabled: Boolean(newForm) });
  const saleItems = trpc.afterSales.items.useQuery({ quoteId: newForm?.quoteId ?? 0 }, { enabled: Boolean(newForm?.quoteId) });

  // Vindo do orçamento (?orcamento=ID), abre a nova ocorrência com a venda escolhida.
  const [handledQuery, setHandledQuery] = useState(false);
  useEffect(() => {
    if (handledQuery) return;
    setHandledQuery(true);
    const quoteId = Number(new URLSearchParams(search).get("orcamento"));
    if (quoteId) setNewForm(emptyNew(quoteId));
  }, [handledQuery, search]);

  const refresh = () => {
    utils.afterSales.invalidate();
    utils.summary.today.invalidate();
  };
  const create = trpc.afterSales.create.useMutation({
    onSuccess: created => {
      refresh();
      setNewForm(null);
      toast.success(`Ocorrência #${created.id} aberta.`);
    },
    onError: err => setFormError(getFormErrorMessage(err, "Não foi possível abrir a ocorrência.")),
  });
  const update = trpc.afterSales.update.useMutation({
    onSuccess: () => {
      refresh();
      utils.inventory.invalidate();
      setEditForm(null);
      toast.success("Ocorrência atualizada.");
    },
    onError: err => setFormError(getFormErrorMessage(err, "Não foi possível atualizar a ocorrência.")),
  });

  const rows = cases.data ?? [];
  const term = query.trim().toLocaleLowerCase("pt-BR");
  const visible = rows.filter(row =>
    (statusFilter === "all" || (statusFilter === "active" ? row.active : row.status === statusFilter))
    && (!term || [row.clientName, row.productDescription, String(row.quoteNumber ?? ""), `#${row.id}`].some(value => value.toLocaleLowerCase("pt-BR").includes(term))));
  const activeCount = rows.filter(row => row.active).length;
  const overdueCount = rows.filter(row => row.overdue).length;
  const editing = editForm ? rows.find(row => row.id === editForm.id) : undefined;
  const selectedItem = saleItems.data?.items.find(item => item.quoteItemId === newForm?.quoteItemId);
  const saleOptions = (sales.data ?? []).filter(sale => {
    const text = saleQuery.trim().toLocaleLowerCase("pt-BR");
    return !text || `#${sale.quoteNumber} ${sale.clientName}`.toLocaleLowerCase("pt-BR").includes(text);
  });

  const openEdit = (row: (typeof rows)[number]) => {
    setFormError("");
    setEditForm({
      id: row.id,
      status: row.status,
      dueDate: formatDateInput(row.dueDate),
      description: row.description ?? "",
      resolution: row.resolution ?? "",
      refundAmount: row.refundAmount ? String(row.refundAmount) : "",
      restock: false,
      replacement: false,
      responsible: "",
    });
  };

  const exportReport = () =>
    report.data && downloadCsv(`pos-venda-${period.from}-a-${period.to}`, report.data.byProduct, [
      { header: "Produto", value: row => row.description },
      { header: "Fornecedor", value: row => row.supplierName ?? "" },
      { header: "Ocorrências", value: row => row.cases },
      { header: "Quantidade", value: row => row.quantity },
      { header: "Unidades vendidas", value: row => row.sold },
      { header: "Taxa de problema (%)", value: row => row.rate ?? "" },
    ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h2 className="page-title">Pós-venda</h2>
          <p className="page-description">
            Trocas, devoluções e garantias dos itens vendidos, com prazo para
            resolver. Ao resolver, a peça devolvida pode voltar ao estoque e a
            peça nova da troca sai do estoque.
          </p>
        </div>
        <Button onClick={() => { setFormError(""); setSaleQuery(""); setNewForm(emptyNew()); }}>
          <Plus className="mr-2 h-4 w-4" />
          Nova ocorrência
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[
          { label: "Em andamento", value: cases.isLoading ? "—" : String(activeCount), icon: LifeBuoy },
          { label: "Prazo vencido", value: cases.isLoading ? "—" : String(overdueCount), icon: AlertTriangle, alert: overdueCount > 0 },
          { label: "Abertas no período", value: report.data ? String(report.data.totals.cases) : "—", icon: Clock3 },
          { label: "Tempo médio para resolver", value: report.data?.totals.averageResolutionDays == null ? "—" : report.data.totals.averageResolutionDays < 1 ? "Menos de 1 dia" : plural(Math.round(report.data.totals.averageResolutionDays), "dia", "dias"), icon: CheckCircle2 },
        ].map(card => (
          <Card key={card.label} className="border-border/70 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <card.icon className={`mb-3 h-5 w-5 ${card.alert ? "text-red-600 dark:text-red-300" : "text-primary"}`} />
              <p className="text-xs font-semibold text-muted-foreground">{card.label}</p>
              <p className={`mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl ${card.alert ? "text-red-700 dark:text-red-300" : ""}`}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="flex gap-2" role="tablist" aria-label="Visualização">
        {([["cases", "Ocorrências"], ["report", "Relatório"]] as const).map(([value, label]) => (
          <Button key={value} role="tab" aria-selected={tab === value} size="sm" variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === "cases" ? (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar por cliente, produto ou orçamento" value={query} onChange={event => setQuery(event.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={value => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger className="sm:w-52" aria-label="Situação"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Em andamento</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                  {AFTER_SALES_STATUSES.map(status => <SelectItem key={status} value={status}>{AFTER_SALES_STATUS_LABELS[status]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {cases.error ? (
              <div role="alert" className="p-6 text-center text-sm">
                Não foi possível carregar o pós-venda.{" "}
                <Button size="sm" variant="outline" onClick={() => cases.refetch()}>Tentar novamente</Button>
              </div>
            ) : visible.length ? (
              <ul className="divide-y divide-border">
                {visible.map(row => (
                  <li key={row.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{AFTER_SALES_TYPE_LABELS[row.type]} #{row.id}</span>
                        <Badge variant="outline" className={STATUS_STYLES[row.status]}>{AFTER_SALES_STATUS_LABELS[row.status]}</Badge>
                        {row.overdue ? <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300">Prazo vencido</Badge> : null}
                      </div>
                      <p className="mt-1 truncate text-sm">
                        {quantityText(row.quantity)} × <b>{row.productDescription}</b>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.clientName} ·{" "}
                        {canOpenQuote && row.quoteNumber ? (
                          <Link href={`/orcamentos/${row.quoteId}`} className="font-semibold text-primary hover:underline">orçamento #{row.quoteNumber}</Link>
                        ) : (
                          <>orçamento #{row.quoteNumber ?? "—"}</>
                        )}{" "}
                        · {AFTER_SALES_REASON_LABELS[row.reason]} · aberta em {dateOnly(row.openedAt)}
                        {row.active ? <> · prazo <b className={row.overdue ? "text-red-700 dark:text-red-300" : "text-foreground"}>{dateOnly(row.dueDate)}</b></> : row.resolvedAt ? <> · encerrada em {dateOnly(row.resolvedAt)}</> : null}
                      </p>
                      {row.resolution ? <p className="mt-1 text-xs"><span className="text-muted-foreground">Solução:</span> {row.resolution}</p> : null}
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => openEdit(row)}>
                      {row.active ? "Atualizar" : "Ver / reabrir"}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {cases.isLoading ? "Carregando…" : rows.length ? "Nenhuma ocorrência com esse filtro." : "Nenhuma ocorrência de pós-venda ainda. Use \"Nova ocorrência\" quando um cliente pedir troca, devolução ou garantia."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button size="sm" variant="outline" disabled={!report.data?.byProduct.length} onClick={exportReport}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Exportar para Excel
            </Button>
          </div>
          {!validPeriod ? <p className="text-sm text-destructive">Escolha um período válido de até um ano.</p> : null}
          <Card className="border-border/70 shadow-sm">
            <CardContent className="p-0">
              <div className="border-b border-border p-4">
                <p className="text-sm font-bold">Produtos com mais ocorrências</p>
                <p className="text-xs text-muted-foreground">
                  Ocorrências abertas no período. A taxa compara a quantidade com problema com todas as unidades já vendidas do produto.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Produto</th>
                      <th className="px-4 py-2">Fornecedor</th>
                      <th className="px-4 py-2 text-right">Ocorrências</th>
                      <th className="px-4 py-2 text-right">Qtd.</th>
                      <th className="px-4 py-2 text-right">Vendidas</th>
                      <th className="px-4 py-2 text-right">Taxa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.data?.byProduct.length ? report.data.byProduct.map(row => (
                      <tr key={`${row.productId ?? row.description}`}>
                        <td className="px-4 py-2 font-semibold">{row.description}</td>
                        <td className="px-4 py-2 text-muted-foreground">{row.supplierName ?? "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.cases}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{quantityText(row.quantity)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.sold ? quantityText(row.sold) : "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{row.rate === null ? "—" : `${quantityText(row.rate)}%`}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{report.isLoading ? "Carregando…" : "Nenhuma ocorrência aberta no período."}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {[
              { title: "Por motivo", rows: report.data?.byReason.map(row => ({ label: AFTER_SALES_REASON_LABELS[row.key as AfterSalesReason], ...row })) },
              { title: "Por tipo", rows: report.data?.byType.map(row => ({ label: AFTER_SALES_TYPE_LABELS[row.key as AfterSalesType], ...row })) },
              { title: "Por fornecedor", rows: report.data?.bySupplier.map(row => ({ label: row.key, ...row })) },
            ].map(block => (
              <Card key={block.title} className="border-border/70 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-sm font-bold">{block.title}</p>
                  {block.rows?.length ? (
                    <ul className="mt-2 divide-y divide-border text-sm">
                      {block.rows.map(row => (
                        <li key={row.key} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="truncate">{row.label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            <b className="text-foreground">{row.cases}</b> · {quantityText(row.quantity)} un.
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Sem dados no período.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={Boolean(newForm)} onOpenChange={value => !value && setNewForm(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nova ocorrência de pós-venda</DialogTitle>
            <DialogDescription>Escolha a venda e o item. Só o que já foi retirado pode entrar em ocorrência, e a garantia é contada de cada retirada.</DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          {newForm ? (
            <div className="space-y-4">
              {!newForm.quoteId ? (
                <div className="space-y-2">
                  <Label htmlFor="sale-search">Venda (orçamento aprovado)</Label>
                  <Input id="sale-search" placeholder="Buscar por número ou cliente" value={saleQuery} onChange={event => setSaleQuery(event.target.value)} />
                  <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
                    {saleOptions.slice(0, 50).map(sale => (
                      <li key={sale.id}>
                        <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/60" onClick={() => setNewForm({ ...newForm, quoteId: sale.id, quoteItemId: null })}>
                          <span className="truncate"><b>#{sale.quoteNumber}</b> {sale.clientName || "sem cliente"}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">aprovado em {dateOnly(sale.approvedAt)}</span>
                        </button>
                      </li>
                    ))}
                    {!saleOptions.length ? <li className="px-3 py-4 text-center text-xs text-muted-foreground">{sales.isLoading ? "Carregando…" : "Nenhuma venda aprovada encontrada."}</li> : null}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                    <span className="truncate">
                      {saleItems.data ? <><b>Orçamento #{saleItems.data.quote.quoteNumber}</b> · {saleItems.data.quote.clientName}</> : "Carregando a venda…"}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setNewForm({ ...newForm, quoteId: null, quoteItemId: null })}>Trocar</Button>
                  </div>
                  {saleItems.error ? <p className="text-sm text-destructive">{saleItems.error.message}</p> : null}
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-medium">Item</legend>
                    {saleItems.data?.items.map(item => (
                      <label key={item.quoteItemId} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${newForm.quoteItemId === item.quoteItemId ? "border-primary bg-primary/5" : "border-border"} ${item.available <= 0 ? "opacity-60" : ""}`}>
                        <input
                          type="radio"
                          name="after-sales-item"
                          className="mt-1"
                          disabled={item.available <= 0}
                          checked={newForm.quoteItemId === item.quoteItemId}
                          onChange={() => setNewForm({ ...newForm, quoteItemId: item.quoteItemId, quantity: String(Math.min(Number(newForm.quantity) || 1, item.available)) })}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{item.shortDescription}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.roomName} · {quantityText(item.quantity)} {item.unit} vendidos · {quantityText(item.delivered)} retirados
                            {item.delivered > 0 && item.available < item.delivered ? ` · ${quantityText(item.available)} disponíveis para pós-venda` : ""}
                          </span>
                          {item.lots.length ? item.lots.map((lot, index) => (
                            <span key={index} className={`mt-1 flex items-center gap-1 text-xs ${lot.underWarranty ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
                              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                              {quantityText(lot.quantity)} {item.unit} retirados em {dateOnly(lot.deliveredAt)} ·{" "}
                              {lot.warrantyUntil ? (lot.underWarranty ? `em garantia até ${dateOnly(lot.warrantyUntil)}` : `garantia vencida em ${dateOnly(lot.warrantyUntil)}`) : "sem garantia cadastrada"}
                            </span>
                          )) : (
                            <span className="mt-1 block text-xs text-muted-foreground">Ainda não retirado: registre a retirada no Estoque antes de abrir a ocorrência.</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Tipo</Label>
                      <Select value={newForm.type} onValueChange={value => setNewForm({ ...newForm, type: value as AfterSalesType })}>
                        <SelectTrigger aria-label="Tipo"><SelectValue /></SelectTrigger>
                        <SelectContent>{AFTER_SALES_TYPES.map(type => <SelectItem key={type} value={type}>{AFTER_SALES_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Motivo</Label>
                      <Select value={newForm.reason} onValueChange={value => setNewForm({ ...newForm, reason: value as AfterSalesReason })}>
                        <SelectTrigger aria-label="Motivo"><SelectValue /></SelectTrigger>
                        <SelectContent>{AFTER_SALES_REASONS.map(reason => <SelectItem key={reason} value={reason}>{AFTER_SALES_REASON_LABELS[reason]}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="after-sales-quantity">Quantidade{selectedItem ? ` (até ${quantityText(selectedItem.available)})` : ""}</Label>
                      <Input id="after-sales-quantity" type="number" min="0.01" step="1" value={newForm.quantity} onChange={event => setNewForm({ ...newForm, quantity: event.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="after-sales-due">Prazo para resolver</Label>
                      <Input id="after-sales-due" type="date" value={newForm.dueDate} onChange={event => setNewForm({ ...newForm, dueDate: event.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="after-sales-description">Relato do cliente</Label>
                    <Textarea id="after-sales-description" rows={3} placeholder="O que aconteceu, fotos recebidas, combinado com o cliente…" value={newForm.description} onChange={event => setNewForm({ ...newForm, description: event.target.value })} />
                  </div>
                  {selectedItem && newForm.type === "warranty" && Number(newForm.quantity.replace(",", ".")) > selectedItem.underWarrantyQuantity ? (
                    <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
                      {selectedItem.underWarrantyQuantity > 0 ? `Só ${quantityText(selectedItem.underWarrantyQuantity)} ${selectedItem.unit} deste item estão em garantia.` : "A garantia deste item já venceu."} A ocorrência pode ser aberta assim mesmo, por cortesia ou acordo com o fornecedor.
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setNewForm(null)}>Cancelar</Button>
                    <AsyncButton
                      pending={create.isPending}
                      loadingLabel="Abrindo…"
                      disabled={!newForm.quoteItemId || !(Number(newForm.quantity) > 0) || !newForm.dueDate}
                      onClick={() => newForm.quoteId && newForm.quoteItemId && create.mutate({
                        quoteId: newForm.quoteId,
                        quoteItemId: newForm.quoteItemId,
                        type: newForm.type,
                        reason: newForm.reason,
                        quantity: Number(newForm.quantity.replace(",", ".")),
                        dueDate: fromDateInput(newForm.dueDate),
                        description: newForm.description || null,
                      })}
                    >
                      Abrir ocorrência
                    </AsyncButton>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editForm)} onOpenChange={value => !value && setEditForm(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `${AFTER_SALES_TYPE_LABELS[editing.type]} #${editing.id}` : "Ocorrência"}</DialogTitle>
            <DialogDescription>
              {editing ? `${quantityText(editing.quantity)} × ${editing.productDescription} · ${editing.clientName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          {editForm && editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Situação</Label>
                  <Select value={editForm.status} onValueChange={value => setEditForm({ ...editForm, status: value as AfterSalesStatus })}>
                    <SelectTrigger aria-label="Situação"><SelectValue /></SelectTrigger>
                    <SelectContent>{AFTER_SALES_STATUSES.map(status => <SelectItem key={status} value={status}>{AFTER_SALES_STATUS_LABELS[status]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-due">Prazo</Label>
                  <Input id="edit-due" type="date" value={editForm.dueDate} onChange={event => setEditForm({ ...editForm, dueDate: event.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-description">Relato do cliente</Label>
                <Textarea id="edit-description" rows={2} value={editForm.description} onChange={event => setEditForm({ ...editForm, description: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-resolution">{editForm.status === "rejected" ? "Por que foi recusada" : "Solução"}{editForm.status === "resolved" || editForm.status === "rejected" ? " *" : ""}</Label>
                <Textarea id="edit-resolution" rows={2} placeholder="Ex.: peça trocada na loja; enviada ao fornecedor com nota de garantia…" value={editForm.resolution} onChange={event => setEditForm({ ...editForm, resolution: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-refund">Valor devolvido ao cliente (R$, opcional)</Label>
                <Input id="edit-refund" type="number" min="0" step="0.01" value={editForm.refundAmount} onChange={event => setEditForm({ ...editForm, refundAmount: event.target.value })} />
                {Number(editForm.refundAmount) > 0 ? <p className="text-xs text-muted-foreground">Fica registrado aqui. Para corrigir o que o cliente pagou, faça o estorno no Financeiro.</p> : null}
              </div>
              {editForm.status === "resolved" && editing.productId ? (
                <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Estoque</p>
                  {editing.type !== "warranty" ? (
                    editing.restockMovementId ? <p className="text-xs text-muted-foreground">A peça devolvida já voltou ao estoque.</p> : (
                      <label className="flex items-start gap-2">
                        <Checkbox checked={editForm.restock} onCheckedChange={value => setEditForm({ ...editForm, restock: value === true })} aria-label="Devolver ao estoque" />
                        <span>Devolver {quantityText(editing.quantity)} ao estoque <span className="block text-xs text-muted-foreground">Só se a peça estiver em condição de venda.</span></span>
                      </label>
                    )
                  ) : null}
                  {editing.type !== "return" ? (
                    editing.replacementMovementId ? <p className="text-xs text-muted-foreground">A peça nova já foi baixada do estoque.</p> : (
                      <label className="flex items-start gap-2">
                        <Checkbox checked={editForm.replacement} onCheckedChange={value => setEditForm({ ...editForm, replacement: value === true })} aria-label="Baixar peça nova do estoque" />
                        <span>Baixar {quantityText(editing.quantity)} peça(s) nova(s) do estoque <span className="block text-xs text-muted-foreground">A peça entregue ao cliente na troca.</span></span>
                      </label>
                    )
                  ) : null}
                  {editForm.restock || editForm.replacement ? (
                    <Input placeholder="Responsável (opcional)" value={editForm.responsible} onChange={event => setEditForm({ ...editForm, responsible: event.target.value })} />
                  ) : null}
                </div>
              ) : null}
              {editForm.status !== "resolved" && (editing.restockMovementId || editing.replacementMovementId) ? (
                <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
                  Ao salvar, o estoque volta atrás:
                  {editing.restockMovementId ? ` ${quantityText(editing.quantity)} peça(s) devolvida(s) saem do estoque.` : ""}
                  {editing.replacementMovementId ? ` ${quantityText(editing.quantity)} peça(s) nova(s) voltam ao estoque.` : ""}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditForm(null)}>Cancelar</Button>
                <AsyncButton
                  pending={update.isPending}
                  loadingLabel="Salvando…"
                  disabled={!editForm.dueDate}
                  onClick={() => update.mutate({
                    id: editForm.id,
                    status: editForm.status,
                    dueDate: fromDateInput(editForm.dueDate),
                    description: editForm.description || null,
                    resolution: editForm.resolution || null,
                    refundAmount: editForm.refundAmount ? Number(editForm.refundAmount.replace(",", ".")) : null,
                    restock: editForm.restock,
                    replacement: editForm.replacement,
                    responsible: editForm.responsible || null,
                  })}
                >
                  Salvar
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {activeCount ? <p className="text-xs text-muted-foreground">{plural(activeCount, "ocorrência em andamento", "ocorrências em andamento")}; as com prazo até hoje aparecem no Resumo do dia.</p> : null}
    </div>
  );
}
