import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateOnly, money } from "@/lib/format";
import {
  addDaysInput,
  allowsInstallments,
  dateFromInput,
  isBilledMethod,
  MAX_PLAN_PARTS,
  PLAN_METHOD_LABELS,
  PLAN_METHODS,
  planSum,
  planTarget,
  validatePaymentPlan,
  type PaymentPlan,
  type PlanMethod,
} from "@shared/paymentPlan";
import { roundMoney } from "@shared/finance";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type PartForm = { method: PlanMethod; amount: string; installments: string; firstDueDate: string };
type Totals = { total: number; pixTotal: number };

const toPlan = (parts: PartForm[]): PaymentPlan => ({
  parts: parts.map(part => ({
    method: part.method,
    amount: roundMoney(Number(part.amount.replace(",", ".")) || 0),
    installments: allowsInstallments(part.method) ? Math.max(1, Math.floor(Number(part.installments) || 1)) : 1,
    firstDueDate: isBilledMethod(part.method) ? part.firstDueDate : null,
  })),
});
const part = (method: PlanMethod, amount: number, installments = 1): PartForm => ({ method, amount: amount.toFixed(2), installments: String(installments), firstDueDate: addDaysInput(30) });

// Atalhos para as combinações mais comuns.
function presets(totals: Totals, installments: number): Array<{ label: string; parts: PartForm[] }> {
  const entry = roundMoney(totals.total * 0.3);
  return [
    { label: "Cartão de crédito", parts: [part("credit_card", totals.total, installments)] },
    { label: "PIX à vista", parts: [part("pix", totals.pixTotal)] },
    { label: "Entrada + crediário", parts: [part("pix", entry), part("store_credit", roundMoney(totals.total - entry), Math.max(2, installments))] },
    { label: "Boleto", parts: [part("boleto", totals.total, installments)] },
  ];
}

// Como o cliente vai pagar: pedido ao aprovar o orçamento.
export function PaymentPlanDialog({ open, totals, installments, onCancel, onConfirm }: { open: boolean; totals: Totals; installments: number; onCancel: () => void; onConfirm: (plan: PaymentPlan) => void }) {
  const [parts, setParts] = useState<PartForm[]>([]);
  // Ao abrir, sugere cartão de crédito no parcelamento do orçamento.
  const { total, pixTotal } = totals;
  useEffect(() => {
    if (open) setParts(presets({ total, pixTotal }, installments)[0]!.parts);
  }, [open, total, pixTotal, installments]);
  const plan = toPlan(parts);
  const target = planTarget(plan, totals);
  const difference = roundMoney(target - planSum(plan));
  const problem = parts.length ? validatePaymentPlan(plan, totals) : "Informe como o cliente vai pagar.";

  const update = (index: number, change: Partial<PartForm>) =>
    setParts(current => {
      const next = current.map((entry, position) => (position === index ? { ...entry, ...change } : entry));
      // Uma forma só: o valor acompanha a venda (PIX à vista usa o preço com desconto).
      if (next.length === 1 && change.method) next[0] = { ...next[0]!, amount: planTarget(toPlan(next), totals).toFixed(2) };
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={value => !value && onCancel()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Como o cliente vai pagar?</DialogTitle>
          <DialogDescription>
            Cartão, PIX, dinheiro e transferência entram como recebidos hoje (no cartão, quem parcela é a operadora). Boleto e crediário próprio geram parcelas mensais no Financeiro.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {presets(totals, installments).map(preset => (
            <Button key={preset.label} size="sm" variant="outline" onClick={() => setParts(preset.parts)}>{preset.label}</Button>
          ))}
        </div>
        <div className="space-y-3">
          {parts.map((entry, index) => {
            const amount = Number(entry.amount.replace(",", ".")) || 0;
            const count = Math.max(1, Math.floor(Number(entry.installments) || 1));
            return (
              <div key={index} className="space-y-2 rounded-xl border border-border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`plan-method-${index}`} className="text-xs">Forma</Label>
                    <select id={`plan-method-${index}`} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={entry.method} onChange={event => update(index, { method: event.target.value as PlanMethod })}>
                      {PLAN_METHODS.map(method => <option key={method} value={method}>{PLAN_METHOD_LABELS[method]}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`plan-amount-${index}`} className="text-xs">Valor (R$)</Label>
                    <Input id={`plan-amount-${index}`} className="h-9" type="number" min="0" step="0.01" value={entry.amount} onChange={event => update(index, { amount: event.target.value })} />
                  </div>
                  <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Remover esta forma" disabled={parts.length === 1} onClick={() => setParts(parts.filter((_, position) => position !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {allowsInstallments(entry.method) ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`plan-installments-${index}`} className="text-xs">{entry.method === "credit_card" ? "Vezes na maquininha" : "Parcelas"}</Label>
                      <Input id={`plan-installments-${index}`} className="h-9" type="number" min="1" max="24" step="1" value={entry.installments} onChange={event => update(index, { installments: event.target.value })} />
                    </div>
                    {isBilledMethod(entry.method) ? (
                      <div className="space-y-1">
                        <Label htmlFor={`plan-first-${index}`} className="text-xs">1ª parcela</Label>
                        <Input id={`plan-first-${index}`} className="h-9" type="date" value={entry.firstDueDate} onChange={event => update(index, { firstDueDate: event.target.value })} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {isBilledMethod(entry.method)
                    ? `${count}x de ${money(amount / count)}${entry.firstDueDate ? `, a partir de ${dateOnly(dateFromInput(entry.firstDueDate))}` : ""}, cobradas mês a mês no Financeiro.`
                    : entry.method === "credit_card" && count > 1
                      ? `Recebido hoje; o cliente paga ${count}x de ${money(amount / count)} para a operadora.`
                      : "Recebido hoje."}
                </p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="outline" disabled={parts.length >= MAX_PLAN_PARTS} onClick={() => setParts([...parts, part("pix", Math.max(0, difference))])}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Outra forma
          </Button>
          <p className="text-sm">
            Venda de <b>{money(target)}</b>
            {target !== totals.total ? <span className="text-xs text-muted-foreground"> (preço do PIX)</span> : null}
            {Math.abs(difference) > 0.009 ? <span className={`ml-2 text-xs font-semibold ${difference > 0 ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"}`}>{difference > 0 ? `faltam ${money(difference)}` : `passou ${money(-difference)}`}</span> : null}
          </p>
        </div>
        {problem && parts.length ? <p className="text-xs text-destructive">{problem}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button disabled={Boolean(problem)} onClick={() => onConfirm(plan)}>Aprovar orçamento</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
