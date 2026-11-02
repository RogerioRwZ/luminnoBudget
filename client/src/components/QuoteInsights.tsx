import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { discountPercent, percentLabel, quoteMargin, type MarginItem } from "@shared/margin";
import { plural } from "@shared/plural";
import { parseAttributes, rankSubstitutes, variantLabel } from "@shared/variants";
import { AlertTriangle, ArrowRightLeft, TrendingUp } from "lucide-react";

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

type FamilyMember = { id: number; code: string; shortDescription: string; imageUrl: string | null; unit: string; unitPrice: string | number; attributes: string | null };

// Item do catálogo sem saldo livre suficiente: mostra o que há e sugere outra
// variação do mesmo modelo que atenda a quantidade.
export function StockShortageHint({
  productId,
  attributes,
  unit,
  needed,
  availability,
  family,
  onSwap,
}: {
  productId: number;
  attributes: string | null;
  unit: string;
  needed: number;
  availability: Map<number, number>;
  family: FamilyMember[];
  onSwap: (member: FamilyMember) => void;
}) {
  const available = availability.get(productId) ?? 0;
  const candidates = family
    .filter(member => member.id !== productId)
    .map(member => ({ ...member, available: availability.get(member.id) ?? 0 }));
  const suggestions = rankSubstitutes(parseAttributes(attributes), candidates, needed);
  // Produto avulso que a loja não costuma ter em estoque (vende sob
  // encomenda): sem saldo e sem alternativa, o aviso seria só ruído.
  if (!suggestions.length && available <= 0 && candidates.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-900 dark:text-amber-100" role="status">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        {available > 0 ? `Só ${available} ${unit} livre${available === 1 ? "" : "s"} em estoque` : "Sem estoque livre"} para {needed} {unit}
        {suggestions.length ? ". Com estoque:" : "; o restante entra em Compras quando aprovado."}
      </span>
      {suggestions.map(member => (
        <Button key={member.id} size="sm" variant="outline" className="h-7 gap-1.5 bg-background px-2 text-[11px]" onClick={() => onSwap(member)}>
          <ArrowRightLeft className="h-3 w-3" />
          {variantLabel(parseAttributes(member.attributes)) || member.shortDescription} ({member.available}) · {money(member.unitPrice)}
        </Button>
      ))}
    </div>
  );
}
