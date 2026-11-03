import { isValidPeriod, PeriodPicker, periodRange, presetPeriod, type Period } from "@/components/PeriodPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { downloadCsv } from "@/lib/csvDownload";
import { compactNumber, dateOnly, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { percentLabel } from "@shared/margin";
import { canSeeCost } from "@shared/permissions";
import { plural } from "@shared/plural";
import type { SalesReportLine, SalesReportRow } from "@shared/salesReport";
import { BarChart3, Download, FileSpreadsheet, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

type Dimension = "bySeller" | "byProfessional" | "byProduct";
const DIMENSIONS: Array<{ key: Dimension; label: string; column: string; file: string }> = [
  { key: "bySeller", label: "Vendedor", column: "Vendedor", file: "vendas-por-vendedor" },
  { key: "byProfessional", label: "Profissional", column: "Profissional", file: "vendas-por-profissional" },
  { key: "byProduct", label: "Produto", column: "Produto", file: "vendas-por-produto" },
];

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Receipt; label: string; value: string; hint?: string }) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <span className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
        {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const { role } = usePermissions();
  const showCost = canSeeCost(role);
  const [period, setPeriod] = useState<Period>(() => presetPeriod("this_month"));
  const [dimension, setDimension] = useState<Dimension>("bySeller");
  const valid = isValidPeriod(period);
  const range = useMemo(() => (valid ? periodRange(period) : null), [period, valid]);
  const { data, isLoading, error, refetch } = trpc.reports.sales.useQuery(range!, { enabled: Boolean(range) });
  const active = DIMENSIONS.find(entry => entry.key === dimension)!;
  const rows = data?.[dimension] ?? [];
  const periodLabel = range ? `${dateOnly(range.from)} a ${dateOnly(new Date(range.to.getTime() - 1))}` : "";

  const exportRows = () =>
    downloadCsv<SalesReportRow>(`${active.file}-${period.from}-a-${period.to}`, rows, [
      { header: active.column, value: row => row.label },
      { header: "Vendas", value: row => row.quotes },
      { header: "Quantidade", value: row => row.quantity },
      { header: "Valor vendido (R$)", value: row => row.revenue },
      { header: "Participação (%)", value: row => (data?.totals.revenue ? Math.round((row.revenue / data.totals.revenue) * 1000) / 10 : 0) },
      ...(showCost
        ? [
            { header: "Custo (R$)", value: (row: SalesReportRow) => (row.coveredRevenue ? row.cost : null) },
            { header: "Lucro bruto (R$)", value: (row: SalesReportRow) => (row.coveredRevenue ? row.profit : null) },
            { header: "Margem (%)", value: (row: SalesReportRow) => (row.margin === null ? null : Math.round(row.margin * 1000) / 10) },
          ]
        : []),
    ]);
  const exportLines = () =>
    downloadCsv(`itens-vendidos-${period.from}-a-${period.to}`, data?.lines ?? [], [
      { header: "Aprovado em", value: line => new Date(line.approvedAt) },
      { header: "Orçamento", value: line => line.quoteNumber },
      { header: "Cliente", value: line => line.clientName },
      { header: "Profissional", value: line => line.professional },
      { header: "Vendedor", value: line => line.sellerName },
      { header: "Código", value: line => line.code },
      { header: "Produto", value: line => line.shortDescription },
      { header: "Unidade", value: line => line.unit },
      { header: "Quantidade", value: line => line.quantity },
      { header: "Valor unitário (R$)", value: line => line.unitPrice },
      { header: "Valor vendido com desconto (R$)", value: line => line.revenue },
      ...(showCost
        ? [
            { header: "Custo unitário (R$)", value: (line: SalesReportLine) => line.unitCost },
            { header: "Custo total (R$)", value: (line: SalesReportLine) => line.cost },
          ]
        : []),
    ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Gestão comercial</p>
          <h2 className="page-title">Relatório de vendas</h2>
          <p className="page-description">
            Orçamentos aprovados no período, pela data de aprovação. O valor
            vendido já desconta o desconto do orçamento e não inclui o frete.
          </p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {!valid ? <p className="text-sm text-destructive">Escolha um período válido de até um ano.</p> : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
          Não foi possível carregar o relatório.{" "}
          <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi icon={Receipt} label="Vendas no período" value={isLoading ? "—" : compactNumber(data?.totals.quotes ?? 0)} hint={data ? `Faturamento ${money(data.totals.total)} com frete` : undefined} />
        <Kpi icon={ShoppingBag} label="Valor vendido" value={isLoading ? "—" : money(data?.totals.revenue)} hint="Mercadoria, já com desconto" />
        <Kpi icon={BarChart3} label="Ticket médio" value={isLoading ? "—" : money(data?.totals.averageTicket)} />
        {showCost ? (
          <Kpi icon={TrendingUp} label="Margem bruta" value={isLoading ? "—" : percentLabel(data?.totals.margin)} hint={data ? `Lucro bruto ${money(data.totals.profit)}` : undefined} />
        ) : null}
      </section>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
            <Tabs value={dimension} onValueChange={value => setDimension(value as Dimension)}>
              <TabsList className="h-auto flex-wrap">
                {DIMENSIONS.map(entry => (
                  <TabsTrigger key={entry.key} value={entry.key}>{entry.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!rows.length} onClick={exportRows}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Exportar para Excel
              </Button>
              <Button size="sm" variant="outline" disabled={!data?.lines.length} onClick={exportLines}>
                <Download className="mr-2 h-4 w-4" />
                Itens vendidos
              </Button>
            </div>
          </div>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/50 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">{active.column}</th>
                    <th className="px-3 py-2.5 text-right">Vendas</th>
                    <th className="px-3 py-2.5 text-right">Qtd.</th>
                    <th className="px-3 py-2.5 text-right">Valor vendido</th>
                    <th className="px-3 py-2.5">Participação</th>
                    {showCost ? <th className="px-3 py-2.5 text-right">Lucro bruto</th> : null}
                    {showCost ? <th className="px-4 py-2.5 text-right">Margem</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(row => {
                    const share = data?.totals.revenue ? row.revenue / data.totals.revenue : 0;
                    return (
                      <tr key={row.key}>
                        <td className="max-w-[320px] truncate px-4 py-2.5 font-semibold" title={row.label}>{row.label}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.quotes}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{compactNumber(row.quantity)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(row.revenue)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">{percentLabel(share)}</span>
                          </div>
                        </td>
                        {showCost ? <td className="px-3 py-2.5 text-right tabular-nums">{row.coveredRevenue ? money(row.profit) : "—"}</td> : null}
                        {showCost ? (
                          <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${row.margin !== null && row.margin < 0 ? "text-red-700 dark:text-red-300" : ""}`}>
                            {percentLabel(row.margin)}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {isLoading ? "Carregando…" : `Nenhuma venda aprovada entre ${periodLabel}.`}
            </p>
          )}
          {showCost && data?.totals.linesWithoutCost ? (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              {plural(data.totals.linesWithoutCost, "item vendido sem custo cadastrado ficou", "itens vendidos sem custo cadastrado ficaram")} fora
              do cálculo de margem. Cadastre o preço de custo no Catálogo.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
