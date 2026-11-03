import { isValidPeriod, PeriodPicker, periodRange, presetPeriod, type Period } from "@/components/PeriodPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadCsv } from "@/lib/csvDownload";
import { dateOnly, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { plural } from "@shared/plural";
import { ABC_DESCRIPTIONS, type AbcClass } from "@shared/stockTurnover";
import { ArrowLeft, FileSpreadsheet, PackageX, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

const IDLE_OPTIONS = [60, 90, 180, 365] as const;
const quantityText = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const ABC_STYLES: Record<AbcClass, string> = {
  A: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  B: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  C: "border-border bg-muted text-muted-foreground",
};

export default function StockTurnoverPage() {
  const [tab, setTab] = useState<"stale" | "abc">("stale");
  const [days, setDays] = useState<number>(90);
  const [period, setPeriod] = useState<Period>(() => presetPeriod("this_year"));
  const validPeriod = isValidPeriod(period);
  const range = useMemo(() => (validPeriod ? periodRange(period) : null), [period, validPeriod]);
  const stale = trpc.inventory.stale.useQuery({ days }, { enabled: tab === "stale" });
  const abc = trpc.inventory.abc.useQuery(range!, { enabled: tab === "abc" && Boolean(range) });

  const exportStale = () =>
    stale.data && downloadCsv(`estoque-parado-${days}-dias`, stale.data.rows, [
      { header: "Código", value: row => row.code },
      { header: "Produto", value: row => row.description },
      { header: "Fornecedor", value: row => row.supplierName ?? "" },
      { header: "Saldo", value: row => row.stock },
      { header: "Unidade", value: row => row.unit },
      { header: "Custo unitário (R$)", value: row => row.unitCost ?? "" },
      { header: "Valor parado (R$)", value: row => row.value ?? "" },
      { header: "Última venda", value: row => (row.lastSaleAt ? dateOnly(row.lastSaleAt) : "nunca vendeu") },
      { header: "Dias sem vender", value: row => row.idleDays },
    ]);
  const exportAbc = () =>
    abc.data && downloadCsv(`curva-abc-${period.from}-a-${period.to}`, abc.data.rows, [
      { header: "Classe", value: row => row.abc },
      { header: "Produto", value: row => row.label },
      { header: "Fornecedor", value: row => row.supplierName ?? "" },
      { header: "Quantidade vendida", value: row => row.quantity },
      { header: "Valor vendido (R$)", value: row => row.revenue },
      { header: "Participação (%)", value: row => row.share },
      { header: "Acumulado (%)", value: row => row.cumulative },
      { header: "Saldo atual", value: row => row.stock },
    ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <Link href="/estoque" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para o estoque
          </Link>
          <p className="eyebrow">Operação e expedição</p>
          <h2 className="page-title">Giro de estoque</h2>
          <p className="page-description">
            Produtos parados há muito tempo, com o dinheiro empatado neles, e a
            curva ABC: quais produtos fazem o faturamento e não podem faltar.
          </p>
        </div>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Relatório">
        {([["stale", "Produtos parados"], ["abc", "Curva ABC"]] as const).map(([value, label]) => (
          <Button key={value} role="tab" aria-selected={tab === value} size="sm" variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === "stale" ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Sem vender há pelo menos</p>
              <Select value={String(days)} onValueChange={value => setDays(Number(value))}>
                <SelectTrigger className="w-44" aria-label="Dias sem vender"><SelectValue /></SelectTrigger>
                <SelectContent>{IDLE_OPTIONS.map(option => <SelectItem key={option} value={String(option)}>{option} dias</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" disabled={!stale.data?.rows.length} onClick={exportStale}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Exportar para Excel
            </Button>
          </div>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {[
              { label: "Produtos parados", value: stale.data ? String(stale.data.totals.products) : "—" },
              { label: "Dinheiro parado (custo)", value: stale.data ? money(stale.data.totals.value) : "—" },
              { label: "Nunca venderam", value: stale.data ? String(stale.data.totals.neverSold) : "—" },
              { label: "Sem custo cadastrado", value: stale.data ? String(stale.data.totals.withoutCost) : "—" },
            ].map(card => (
              <Card key={card.label} className="border-border/70 shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <PackageX className="mb-3 h-5 w-5 text-primary" />
                  <p className="text-xs font-semibold text-muted-foreground">{card.label}</p>
                  <p className="mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl">{card.value}</p>
                </CardContent>
              </Card>
            ))}
          </section>
          <Card className="border-border/70 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Produto</th>
                      <th className="px-4 py-2">Fornecedor</th>
                      <th className="px-4 py-2 text-right">Saldo</th>
                      <th className="px-4 py-2 text-right">Valor parado</th>
                      <th className="px-4 py-2">Última venda</th>
                      <th className="px-4 py-2 text-right">Dias</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stale.data?.rows.length ? stale.data.rows.map(row => (
                      <tr key={row.productId}>
                        <td className="px-4 py-2"><span className="font-semibold">{row.description}</span> <span className="text-xs text-muted-foreground">#{row.code}</span></td>
                        <td className="px-4 py-2 text-muted-foreground">{row.supplierName ?? "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{quantityText(row.stock)} {row.unit}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{row.value === null ? <span className="text-xs font-normal text-muted-foreground">sem custo</span> : money(row.value)}</td>
                        <td className="px-4 py-2">{row.lastSaleAt ? dateOnly(row.lastSaleAt) : <span className="text-muted-foreground">nunca vendeu</span>}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.idleDays}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{stale.isLoading ? "Carregando…" : `Nenhum produto com saldo parado há ${days} dias ou mais.`}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Conta da última venda aprovada; se o produto nunca vendeu, da primeira entrada no estoque. O valor parado usa o preço de custo do Catálogo.
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button size="sm" variant="outline" disabled={!abc.data?.rows.length} onClick={exportAbc}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Exportar para Excel
            </Button>
          </div>
          {!validPeriod ? <p className="text-sm text-destructive">Escolha um período válido de até um ano.</p> : null}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {(abc.data?.summary ?? (["A", "B", "C"] as const).map(abcClass => ({ abc: abcClass, products: 0, revenue: 0, share: 0 }))).map(group => (
              <Card key={group.abc} className="border-border/70 shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={`text-sm font-bold ${ABC_STYLES[group.abc]}`}>Classe {group.abc}</Badge>
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <p className="mt-3 font-display text-xl font-bold tracking-tight">{abc.data ? plural(group.products, "produto", "produtos") : "—"}</p>
                  <p className="text-xs text-muted-foreground">{abc.data ? `${money(group.revenue)} · ${quantityText(group.share)}% do valor vendido` : ""}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{ABC_DESCRIPTIONS[group.abc]}</p>
                </CardContent>
              </Card>
            ))}
          </section>
          <Card className="border-border/70 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Classe</th>
                      <th className="px-4 py-2">Produto</th>
                      <th className="px-4 py-2 text-right">Qtd. vendida</th>
                      <th className="px-4 py-2 text-right">Valor vendido</th>
                      <th className="px-4 py-2 text-right">Participação</th>
                      <th className="px-4 py-2 text-right">Acumulado</th>
                      <th className="px-4 py-2 text-right">Saldo atual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {abc.data?.rows.length ? abc.data.rows.map(row => (
                      <tr key={row.productId}>
                        <td className="px-4 py-2"><Badge variant="outline" className={ABC_STYLES[row.abc]}>{row.abc}</Badge></td>
                        <td className="px-4 py-2"><span className="font-semibold">{row.label}</span>{row.supplierName ? <span className="block text-xs text-muted-foreground">{row.supplierName}</span> : null}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{quantityText(row.quantity)} {row.unit}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(row.revenue)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{quantityText(row.share)}%</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{quantityText(row.cumulative)}%</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${row.abc === "A" && row.stock <= row.reorderPoint ? "font-bold text-red-700 dark:text-red-300" : ""}`}>
                          {quantityText(row.stock)} {row.unit}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{abc.isLoading ? "Carregando…" : "Nenhuma venda de produto do catálogo no período."}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Considera os orçamentos aprovados no período, pelo valor vendido (com o desconto, sem o frete). Produtos da classe A com saldo no ponto de reposição ou abaixo aparecem em vermelho.
          </p>
        </>
      )}
    </div>
  );
}
