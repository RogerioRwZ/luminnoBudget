import { getFormErrorMessage } from "@/components/FormFeedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { dateOnly, formatDateInput, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { dateFromInput } from "@shared/paymentPlan";
import { plural } from "@shared/plural";
import { CreditCard, ListChecks } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

// Orçamentos aprovados antes da forma de pagamento existir: tiveram parcelas
// mensais criadas mesmo quando foram pagos no cartão. Aqui a loja diz como foi.
export function LegacyPlanReview() {
  const utils = trpc.useUtils();
  const { data: rows = [] } = trpc.finance.legacy.useQuery();
  const [open, setOpen] = useState(false);
  const [cardForm, setCardForm] = useState<Record<number, { installments: string; paidAt: string }>>({});
  const settle = trpc.finance.settleLegacy.useMutation({
    onSuccess: () => {
      utils.finance.invalidate();
      toast.success("Forma de pagamento registrada.");
    },
    onError: error => toast.error(getFormErrorMessage(error, "Não foi possível registrar a forma de pagamento.")),
  });
  if (!rows.length) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
            <div>
              <p className="text-sm font-bold">Revise a forma de pagamento de {plural(rows.length, "venda antiga", "vendas antigas")}</p>
              <p className="text-xs text-muted-foreground">
                Antes desta versão, toda venda aprovada ganhava parcelas mensais, mesmo quando foi paga no cartão. Diga como cada uma foi paga: no cartão, as parcelas são canceladas e o recebimento entra na data da venda.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(!open)}>{open ? "Esconder" : "Revisar"}</Button>
        </div>
        {open ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {rows.map(row => {
              const form = cardForm[row.id] ?? { installments: String(row.installments), paidAt: formatDateInput(row.approvedAt ?? new Date()) };
              const update = (change: Partial<typeof form>) => setCardForm({ ...cardForm, [row.id]: { ...form, ...change } });
              return (
                <li key={row.id} className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <Link href={`/orcamentos/${row.id}`} className="font-semibold text-primary hover:underline">#{row.quoteNumber}</Link> {row.clientName}
                    <p className="text-xs text-muted-foreground">{row.installments} parcelas de {money(row.amount / row.installments)} · 1ª em {dateOnly(row.firstDueDate)} · total {money(row.amount)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input aria-label={`Vezes no cartão do orçamento ${row.quoteNumber}`} type="number" min="1" max="24" className="h-9 w-16 rounded-md border border-input bg-background px-2 text-sm" value={form.installments} onChange={event => update({ installments: event.target.value })} />
                    <span className="text-xs text-muted-foreground">x em</span>
                    <input aria-label={`Data do pagamento do orçamento ${row.quoteNumber}`} type="date" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={form.paidAt} onChange={event => update({ paidAt: event.target.value })} />
                    <Button size="sm" disabled={settle.isPending || !form.paidAt} onClick={() => settle.mutate({ quoteId: row.id, method: "credit_card", installments: Math.max(1, Number(form.installments) || 1), paidAt: dateFromInput(form.paidAt) })}>
                      <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                      Foi no cartão
                    </Button>
                    <Button size="sm" variant="outline" disabled={settle.isPending} onClick={() => settle.mutate({ quoteId: row.id, method: "store_credit", installments: row.installments, paidAt: new Date() })}>Crediário</Button>
                    <Button size="sm" variant="outline" disabled={settle.isPending} onClick={() => settle.mutate({ quoteId: row.id, method: "boleto", installments: row.installments, paidAt: new Date() })}>Boleto</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
