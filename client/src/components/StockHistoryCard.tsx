import { SearchInput } from "@/components/SearchInput";
import { ShowMoreButton } from "@/components/ShowMoreButton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVisibleItems } from "@/hooks/useVisibleItems";
import { dateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { keepPreviousData } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, History, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

const qty = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const movementMeta = {
  entry: { label: "Entrada", icon: ArrowDownToLine, className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  delivery: { label: "Entrega", icon: ArrowUpFromLine, className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  adjustment: { label: "Ajuste", icon: SlidersHorizontal, className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  return: { label: "Devolução", icon: RotateCcw, className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  loan_out: { label: "Empréstimo", icon: ArrowUpFromLine, className: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
  loan_return: { label: "Volta do empréstimo", icon: ArrowDownToLine, className: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
} as const;
type MovementType = keyof typeof movementMeta;

// A busca vai ao servidor: alcança todo o histórico, não só o que veio na tela.
export function StockHistoryCard() {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<MovementType | "">("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const history = trpc.inventory.movements.useQuery({ search: search || undefined, type: type || undefined }, { placeholderData: keepPreviousData });
  const rows = history.data?.rows ?? [];
  const filtering = Boolean(search || type);
  const { visible, remaining, showMore } = useVisibleItems(rows, `${search}|${type}`, 10);
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-lg">Histórico de movimentações</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {history.data?.limited ? `Mostrando as ${history.data.limit} mais recentes${filtering ? " que batem com a busca" : ""}. A busca alcança todo o histórico.` : "Entradas, entregas, ajustes, devoluções e empréstimos, dos mais recentes aos mais antigos."}
            </p>
          </div>
          <History className="h-5 w-5 shrink-0 text-primary" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchInput className="flex-1" ariaLabel="Buscar nas movimentações" placeholder="Produto, referência, cliente, responsável, observação ou nº do orçamento" value={text} onChange={setText} />
          <select aria-label="Filtrar movimentações por tipo" className="h-9 rounded-md border border-input bg-background px-2 text-sm sm:w-48" value={type} onChange={(event) => setType(event.target.value as MovementType | "")}>
            <option value="">Todos os tipos</option>
            {(Object.keys(movementMeta) as MovementType[]).map((value) => <option key={value} value={value}>{movementMeta[value].label}</option>)}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {history.error ? (
          <p role="alert" className="py-8 text-center text-sm text-muted-foreground">Não foi possível carregar o histórico. Tente novamente em instantes.</p>
        ) : rows.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-3">Data</th>
                    <th className="pb-3">Produto</th>
                    <th className="pb-3">Tipo</th>
                    <th className="pb-3">Qtd.</th>
                    <th className="pb-3">Saldo</th>
                    <th className="pb-3">Destino / responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((movement) => {
                    const meta = movementMeta[movement.type];
                    const Icon = meta.icon;
                    return (
                      <tr key={movement.id} className="border-b border-border/70 align-top last:border-0">
                        <td className="whitespace-nowrap py-3 pr-3 text-xs">{dateTime(movement.occurredAt)}</td>
                        <td className="py-3 pr-3">
                          <p className="font-semibold">{movement.product?.shortDescription || "Produto removido"}</p>
                          <p className="text-[11px] text-muted-foreground">{movement.product?.reference ?? movement.product?.code}</p>
                        </td>
                        <td className="py-3 pr-3">
                          <Badge variant="secondary" className={meta.className}><Icon className="mr-1 h-3 w-3" />{meta.label}</Badge>
                        </td>
                        <td className="py-3 pr-3 font-semibold">{movement.quantity > 0 ? "+" : ""}{qty(movement.quantity)}</td>
                        <td className="whitespace-nowrap py-3 pr-3 text-xs">{qty(movement.beforeQuantity)} → {qty(movement.afterQuantity)}</td>
                        <td className="py-3 text-xs text-muted-foreground">
                          <p>
                            {movement.quoteNumber ? `Orçamento #${movement.quoteNumber} · ` : ""}
                            {movement.clientName || movement.responsible || "Movimentação interna"}
                            {movement.responsible && movement.clientName ? ` · ${movement.responsible}` : ""}
                          </p>
                          {movement.notes ? <p className="mt-0.5 break-words">{movement.notes}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ShowMoreButton remaining={remaining} onClick={showMore} />
          </>
        ) : (
          <div className="py-10 text-center">
            <History className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">{history.isLoading ? "Carregando…" : filtering ? "Nenhuma movimentação encontrada." : "Ainda não há movimentações."}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
