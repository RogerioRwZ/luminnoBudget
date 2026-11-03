import { money } from "@/lib/format";
import { discountPercent, percentLabel, quoteMargin, type MarginItem } from "@shared/margin";
import { plural } from "@shared/plural";
import { AlertTriangle, TrendingUp } from "lucide-react";

// Aviso de desconto acima do limite e, para quem vê custo, a margem do orçamento.
export function QuoteMarginPanel({
  items,
  productsSubtotal,
  discountAmount,
  maxDiscountPercent,
  minMarginPercent,
  showCost,
}: {
  items: MarginItem[];
  productsSubtotal: number;
  discountAmount: number;
  maxDiscountPercent: number;
  minMarginPercent: number;
  showCost: boolean;
}) {
  const discount = discountPercent(productsSubtotal, discountAmount);
  const overDiscount = maxDiscountPercent > 0 && discount > maxDiscountPercent + 0.001;
  const margin = showCost ? quoteMargin(items, discountAmount) : null;
  const lowMargin = margin?.margin !== null && margin?.margin !== undefined && minMarginPercent > 0 && margin.margin * 100 < minMarginPercent;
  return (
    <>
      {overDiscount ? (
        <p role="status" className="flex gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Desconto de {percentLabel(discount / 100)} passa do limite de {percentLabel(maxDiscountPercent / 100)} definido nas Configurações.
        </p>
      ) : null}
      {margin && margin.revenue > 0 ? (
        <div className={`rounded-lg p-2.5 text-xs ${lowMargin || (margin.margin ?? 0) < 0 ? "bg-red-500/10 text-red-900 dark:text-red-100" : "bg-muted/60"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold">
              <TrendingUp className="h-3.5 w-3.5" />
              Margem
            </span>
            <b className="font-display text-sm">{percentLabel(margin.margin)}</b>
          </div>
          {margin.margin !== null ? (
            <p className="mt-1 text-muted-foreground">
              Lucro bruto {money(margin.profit)} sobre custo de {money(margin.cost)} (sem frete).
            </p>
          ) : null}
          {lowMargin ? <p className="mt-1 font-semibold">Abaixo da margem mínima de {percentLabel(minMarginPercent / 100)}.</p> : null}
          {margin.missingCost ? (
            <p className="mt-1 text-muted-foreground">
              {plural(margin.missingCost, "item sem custo cadastrado ficou", "itens sem custo cadastrado ficaram")} fora da conta.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// Item do catálogo sem saldo livre suficiente: mostra o que há. Sem nenhum
// saldo, o produto costuma ser sob encomenda e o aviso seria só ruído.
export function StockShortageHint({
  productId,
  unit,
  needed,
  availability,
}: {
  productId: number;
  unit: string;
  needed: number;
  availability: Map<number, number>;
}) {
  const available = availability.get(productId) ?? 0;
  if (available <= 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-900 dark:text-amber-100" role="status">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Só {available} {unit} livre{available === 1 ? "" : "s"} em estoque para {needed} {unit}; o restante entra em Compras quando aprovado.
      </span>
    </div>
  );
}
