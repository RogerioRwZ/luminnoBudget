import { AsyncButton, FormError, getFormErrorMessage } from "@/components/FormFeedback";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isValidPeriod, PeriodPicker, periodRange, presetPeriod, type Period } from "@/components/PeriodPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadCsv } from "@/lib/csvDownload";
import { dateOnly, formatDateInput, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { plural } from "@shared/plural";
import { ChevronDown, FileSpreadsheet, HandCoins, Percent, Trash2, UserPlus, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type RateForm = { name: string; percent: string; phone: string; isNew: boolean };
type PayForm = { professional: string; amount: string; paidAt: string; notes: string };

const percentText = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export default function CommissionsPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState<Period>(() => presetPeriod("this_month"));
  const valid = isValidPeriod(period);
  const range = useMemo(() => (valid ? periodRange(period) : null), [period, valid]);
  const { data, isLoading, error, refetch } = trpc.commissions.overview.useQuery(range!, { enabled: Boolean(range) });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rateForm, setRateForm] = useState<RateForm | null>(null);
  const [payForm, setPayForm] = useState<PayForm | null>(null);
  const [removing, setRemoving] = useState<{ id: number; label: string } | null>(null);
  const [formError, setFormError] = useState("");
  const done = (message: string) => {
    utils.commissions.invalidate();
    setFormError("");
    toast.success(message);
  };
  const saveRate = trpc.commissions.saveProfessional.useMutation({
    onSuccess: () => {
      done("Comissão salva.");
      setRateForm(null);
    },
    onError: err => setFormError(getFormErrorMessage(err, "Não foi possível salvar a comissão.")),
  });
  const pay = trpc.commissions.pay.useMutation({
    onSuccess: () => {
      done("Pagamento de comissão registrado.");
      setPayForm(null);
    },
    onError: err => setFormError(getFormErrorMessage(err, "Não foi possível registrar o pagamento.")),
  });
  const removePayment = trpc.commissions.deletePayment.useMutation({
    onSuccess: () => {
      done("Pagamento excluído.");
      setRemoving(null);
    },
    onError: err => toast.error(getFormErrorMessage(err, "Não foi possível excluir o pagamento.")),
  });
  const rows = data?.professionals ?? [];

  const exportCsv = () =>
    downloadCsv(`comissoes-${period.from}-a-${period.to}`, rows, [
      { header: "Profissional", value: row => row.name },
      { header: "Comissão (%)", value: row => row.currentPercent },
      { header: "Vendido no período (R$)", value: row => row.soldInPeriod },
      { header: "Recebido no período (R$)", value: row => row.receivedInPeriod },
      { header: "Comissão gerada no período (R$)", value: row => row.commissionInPeriod },
      { header: "Pago no período (R$)", value: row => row.paidInPeriod },
      { header: "Saldo a pagar (R$)", value: row => row.balance },
    ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h2 className="page-title">Comissões de profissionais</h2>
          <p className="page-description">
            A comissão é gerada conforme o cliente paga (sem o frete), no
            percentual fixado quando o orçamento foi aprovado. O saldo a pagar
            considera todo o histórico.
          </p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {!valid ? <p className="text-sm text-destructive">Escolha um período válido de até um ano.</p> : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
          Não foi possível carregar as comissões.{" "}
          <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[
          { label: "Vendido com profissional", value: data?.totals.soldInPeriod, icon: Wallet },
          { label: "Comissão gerada no período", value: data?.totals.commissionInPeriod, icon: Percent },
          { label: "Pago no período", value: data?.totals.paidInPeriod, icon: HandCoins },
          { label: "Saldo a pagar", value: data?.totals.balance, icon: Wallet },
        ].map(card => (
          <Card key={card.label} className="border-border/70 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <card.icon className="mb-3 h-5 w-5 text-primary" />
              <p className="text-xs font-semibold text-muted-foreground">{card.label}</p>
              <p className="mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl">{isLoading ? "—" : money(card.value)}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Comissão padrão da loja: <b className="text-foreground">{percentText(data?.defaultPercent ?? 0)}</b>{" "}
              (em Configurações). Defina um percentual próprio por profissional quando for diferente.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!rows.length} onClick={exportCsv}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Exportar para Excel
              </Button>
              <Button size="sm" onClick={() => { setFormError(""); setRateForm({ name: "", percent: "", phone: "", isNew: true }); }}>
                <UserPlus className="mr-2 h-4 w-4" />
                Cadastrar profissional
              </Button>
            </div>
          </div>
          {rows.length ? (
            <div className="divide-y divide-border">
              {rows.map(row => {
                const open = expanded === row.key;
                return (
                  <div key={row.key} className="p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                      <button className="flex min-w-0 flex-1 items-center gap-2 text-left xl:min-w-[14rem]" onClick={() => setExpanded(open ? null : row.key)} aria-expanded={open}>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{row.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {percentText(row.currentPercent)}
                            {row.registered ? "" : " (padrão)"} · {plural(row.quotes.length, "venda no período", "vendas no período")}
                          </span>
                        </span>
                      </button>
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4 xl:w-[30rem] xl:shrink-0">
                        <div><dt className="text-muted-foreground">Vendido</dt><dd className="font-semibold tabular-nums">{money(row.soldInPeriod)}</dd></div>
                        <div><dt className="text-muted-foreground">Comissão gerada</dt><dd className="font-semibold tabular-nums">{money(row.commissionInPeriod)}</dd></div>
                        <div><dt className="text-muted-foreground">Pago</dt><dd className="font-semibold tabular-nums">{money(row.paidInPeriod)}</dd></div>
                        <div>
                          <dt className="text-muted-foreground">Saldo a pagar</dt>
                          <dd className={`font-display text-sm font-bold tabular-nums ${row.balance > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{money(row.balance)}</dd>
                        </div>
                      </dl>
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setFormError(""); setRateForm({ name: row.name, percent: row.registered ? String(row.currentPercent) : "", phone: row.phone ?? "", isNew: false }); }}>
                          <Percent className="mr-1.5 h-3.5 w-3.5" />
                          Percentual
                        </Button>
                        <Button size="sm" disabled={row.balance <= 0} onClick={() => { setFormError(""); setPayForm({ professional: row.name, amount: row.balance.toFixed(2), paidAt: formatDateInput(new Date()), notes: "" }); }}>
                          <HandCoins className="mr-1.5 h-3.5 w-3.5" />
                          Pagar
                        </Button>
                      </div>
                    </div>
                    {open ? (
                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                        <div className="overflow-x-auto rounded-xl border border-border">
                          <table className="w-full min-w-[520px] text-xs">
                            <thead className="bg-muted/50 text-left font-bold uppercase tracking-wide text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2">Orçamento</th>
                                <th className="px-3 py-2">Aprovado</th>
                                <th className="px-3 py-2 text-right">Total</th>
                                <th className="px-3 py-2 text-right">Recebido</th>
                                <th className="px-3 py-2 text-right">%</th>
                                <th className="px-3 py-2 text-right">Comissão</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {row.quotes.length ? row.quotes.map(quote => (
                                <tr key={quote.id}>
                                  <td className="px-3 py-2">
                                    <button className="font-semibold text-primary hover:underline" onClick={() => setLocation(`/orcamentos/${quote.id}`)}>
                                      #{quote.quoteNumber}
                                    </button>{" "}
                                    {quote.clientName}
                                  </td>
                                  <td className="px-3 py-2">{dateOnly(quote.approvedAt)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{money(quote.total)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{money(quote.received)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{percentText(quote.percent)}</td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(quote.commission)}</td>
                                </tr>
                              )) : (
                                <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Nenhuma venda ou recebimento no período.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div className="rounded-xl border border-border p-3">
                          <p className="text-xs font-bold">Pagamentos no período</p>
                          {row.payments.length ? (
                            <ul className="mt-2 divide-y divide-border text-xs">
                              {row.payments.map(payment => (
                                <li key={payment.id} className="flex items-center justify-between gap-2 py-1.5">
                                  <span>
                                    {dateOnly(payment.paidAt)} · <b>{money(payment.amount)}</b>
                                    {payment.notes ? <span className="block text-muted-foreground">{payment.notes}</span> : null}
                                  </span>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label="Excluir pagamento" onClick={() => setRemoving({ id: payment.id, label: `${money(payment.amount)} para ${row.name}` })}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">Nenhum pagamento no período.</p>
                          )}
                          <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                            Histórico: gerado {money(row.earnedTotal)} · pago {money(row.paidTotal)}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {isLoading ? "Carregando…" : "Nenhum profissional ainda. O nome informado em \"Profissional responsável\" nos orçamentos aprovados aparece aqui."}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(rateForm)} onOpenChange={value => !value && setRateForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rateForm?.isNew ? "Cadastrar profissional" : `Comissão de ${rateForm?.name}`}</DialogTitle>
            <DialogDescription>
              O novo percentual vale para os próximos orçamentos aprovados. Vendas já aprovadas mantêm o percentual da aprovação.
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          {rateForm ? (
            <div className="space-y-3">
              {rateForm.isNew ? (
                <div className="space-y-1.5">
                  <Label htmlFor="professional-name">Nome (igual ao usado nos orçamentos)</Label>
                  <Input id="professional-name" value={rateForm.name} onChange={event => setRateForm({ ...rateForm, name: event.target.value })} />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="professional-percent">Comissão (%)</Label>
                <Input id="professional-percent" type="number" min="0" max="100" step="0.5" placeholder={`Padrão da loja (${percentText(data?.defaultPercent ?? 0)})`} value={rateForm.percent} onChange={event => setRateForm({ ...rateForm, percent: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="professional-phone">Telefone (opcional)</Label>
                <Input id="professional-phone" value={rateForm.phone} onChange={event => setRateForm({ ...rateForm, phone: event.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRateForm(null)}>Cancelar</Button>
                <AsyncButton
                  pending={saveRate.isPending}
                  loadingLabel="Salvando…"
                  disabled={!rateForm.name.trim()}
                  onClick={() => saveRate.mutate({ name: rateForm.name, commissionPercent: rateForm.percent.trim() === "" ? null : Number(rateForm.percent.replace(",", ".")), phone: rateForm.phone || null })}
                >
                  Salvar
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(payForm)} onOpenChange={value => !value && setPayForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pagar comissão de {payForm?.professional}</DialogTitle>
            <DialogDescription>Registre o valor pago ao profissional. O saldo a pagar é atualizado na hora.</DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          {payForm ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="commission-amount">Valor (R$)</Label>
                  <Input id="commission-amount" type="number" min="0" step="0.01" value={payForm.amount} onChange={event => setPayForm({ ...payForm, amount: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="commission-date">Data</Label>
                  <Input id="commission-date" type="date" value={payForm.paidAt} onChange={event => setPayForm({ ...payForm, paidAt: event.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="commission-notes">Observação</Label>
                <Input id="commission-notes" placeholder="PIX, transferência…" value={payForm.notes} onChange={event => setPayForm({ ...payForm, notes: event.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPayForm(null)}>Cancelar</Button>
                <AsyncButton
                  pending={pay.isPending}
                  loadingLabel="Registrando…"
                  disabled={!(Number(payForm.amount) > 0) || !payForm.paidAt}
                  onClick={() => {
                    const [y, m, d] = payForm.paidAt.split("-").map(Number);
                    pay.mutate({ professional: payForm.professional, amount: Number(payForm.amount), paidAt: new Date(y!, m! - 1, d!, 12), notes: payForm.notes || null });
                  }}
                >
                  Registrar pagamento
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={value => !value && setRemoving(null)}
        title="Excluir pagamento de comissão?"
        description={removing ? `O pagamento de ${removing.label} será removido e o valor volta para o saldo a pagar.` : ""}
        confirmLabel="Excluir"
        destructive
        onConfirm={() => removing && removePayment.mutate({ id: removing.id })}
      />
      {rows.some(row => !row.registered) ? (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1 text-[10px]">padrão</Badge>
          Profissionais sem percentual próprio usam a comissão padrão da loja.
        </p>
      ) : null}
    </div>
  );
}
