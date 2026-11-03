import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateOnly } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { AFTER_SALES_STATUS_LABELS, AFTER_SALES_TYPE_LABELS } from "@shared/afterSales";
import { LifeBuoy, Plus } from "lucide-react";
import { useLocation } from "wouter";

// Ocorrências de pós-venda de um orçamento aprovado, com atalho para abrir uma nova.
export function AfterSalesQuotePanel({ quoteId }: { quoteId: number }) {
  const [, setLocation] = useLocation();
  const { data: cases = [], isLoading } = trpc.afterSales.list.useQuery({ quoteId });
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="border-b border-border bg-muted/30 pb-4">
        <CardTitle className="flex items-center gap-2 font-display text-lg">
          <LifeBuoy className="h-4 w-4 text-primary" />
          Pós-venda
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : cases.length ? (
          cases.slice(0, 5).map(item => (
            <div key={item.id} className="rounded-lg bg-muted/50 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <b>{AFTER_SALES_TYPE_LABELS[item.type]} #{item.id}</b>
                <Badge variant="secondary" className={item.overdue ? "bg-red-500/10 text-red-700 dark:text-red-300" : undefined}>
                  {item.overdue ? "Prazo vencido" : AFTER_SALES_STATUS_LABELS[item.status]}
                </Badge>
              </div>
              <p className="mt-1 truncate text-muted-foreground">{item.quantity} × {item.productDescription} · {item.active ? `prazo ${dateOnly(item.dueDate)}` : `aberta em ${dateOnly(item.openedAt)}`}</p>
            </div>
          ))
        ) : (
          <p className="text-center text-xs leading-relaxed text-muted-foreground">Nenhuma troca, devolução ou garantia neste orçamento.</p>
        )}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => setLocation(`/pos-venda?orcamento=${quoteId}`)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Registrar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLocation("/pos-venda")}>Abrir pós-venda</Button>
        </div>
      </CardContent>
    </Card>
  );
}
