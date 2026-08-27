import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { dateOnly, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  ExpirationQuickFilter,
  matchesExpirationQuickFilter,
} from "@shared/quoteAlerts";
import {
  matchesQuoteStatusFilter,
  QuoteStatusFilter,
} from "@shared/quoteStatus";
import { CalendarDays, Copy, FileText, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const statusInfo = {
  draft: {
    label: "Rascunho",
    className: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  open: {
    label: "Em aberto",
    className: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  approved: {
    label: "Aprovado",
    className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  lost: {
    label: "Rejeitado",
    className: "bg-red-500/10 text-red-700 dark:text-red-300",
  },
};

export default function QuotesPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error, refetch } = trpc.quote.list.useQuery();
  const create = trpc.quote.create.useMutation({
    onSuccess: quote => quote && setLocation(`/orcamentos/${quote.id}`),
    onError: error => toast.error(error.message),
  });
  const duplicate = trpc.quote.duplicate.useMutation({
    onSuccess: quote => {
      if (quote) setLocation(`/orcamentos/${quote.id}`);
    },
    onError: error => toast.error(error.message),
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>("all");
  const [expirationFilter, setExpirationFilter] =
    useState<ExpirationQuickFilter>("all");
  const chooseStatus = (filter: QuoteStatusFilter) => {
    setStatusFilter(filter);
    setExpirationFilter("all");
  };
  const chooseExpiration = (filter: Exclude<ExpirationQuickFilter, "all">) => {
    setExpirationFilter(filter);
    setStatusFilter("pending");
  };
  const filtered = useMemo(
    () =>
      (data ?? []).filter(
        quote =>
          `${quote.quoteNumber} ${quote.clientName} ${quote.professional}`
            .toLocaleLowerCase("pt-BR")
            .includes(search.toLocaleLowerCase("pt-BR")) &&
          matchesQuoteStatusFilter(quote.status, statusFilter) &&
          matchesExpirationQuickFilter(quote, expirationFilter)
      ),
    [data, search, statusFilter, expirationFilter]
  );
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Carteira comercial</p>
          <h2 className="page-title">Orçamentos</h2>
          <p className="page-description">
            Crie propostas completas, acompanhe o status e retome edições a
            qualquer momento.
          </p>
        </div>
        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="h-11 px-5"
        >
          <Plus className="mr-2 h-4 w-4" />
          Novo orçamento
        </Button>
      </div>
      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative max-w-md flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Buscar por número, cliente ou profissional"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por número, cliente ou profissional"
                  className="h-10 pl-9"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {filtered.length} proposta(s)
              </span>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Status
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={
                    statusFilter === "all" && expirationFilter === "all"
                      ? "default"
                      : "outline"
                  }
                  onClick={() => {
                    setStatusFilter("all");
                    setExpirationFilter("all");
                  }}
                >
                  Todos
                </Button>
                <Button
                  size="sm"
                  variant={
                    statusFilter === "pending" && expirationFilter === "all"
                      ? "default"
                      : "outline"
                  }
                  onClick={() => chooseStatus("pending")}
                >
                  Pendentes
                </Button>
                <Button
                  size="sm"
                  variant={statusFilter === "approved" ? "default" : "outline"}
                  onClick={() => chooseStatus("approved")}
                >
                  Aprovados
                </Button>
                <Button
                  size="sm"
                  variant={statusFilter === "lost" ? "default" : "outline"}
                  onClick={() => chooseStatus("lost")}
                >
                  Rejeitados
                </Button>
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                Validade
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={expirationFilter === "today" ? "default" : "outline"}
                  onClick={() => chooseExpiration("today")}
                >
                  Vencem hoje
                </Button>
                <Button
                  size="sm"
                  variant={
                    expirationFilter === "expired" ? "default" : "outline"
                  }
                  onClick={() => chooseExpiration("expired")}
                >
                  Já vencidos
                </Button>
                {expirationFilter !== "all" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setExpirationFilter("all");
                      setStatusFilter("all");
                    }}
                  >
                    Limpar
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Carregando orçamentos…
            </div>
          ) : error ? (
            <div
              role="alert"
              className="space-y-3 p-8 text-center text-sm text-muted-foreground"
            >
              <p>Não foi possível carregar os orçamentos.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : filtered.length ? (
            <div className="divide-y divide-border">
              {filtered.map(quote => {
                const info = statusInfo[quote.status];
                const isExpirationFiltered =
                  expirationFilter !== "all" && quote.validUntil;
                return (
                  <div
                    key={quote.id}
                    className="group flex flex-col gap-4 p-4 transition hover:bg-muted/30 md:flex-row md:items-center"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted font-display text-sm font-bold">
                      #{quote.quoteNumber}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold">
                          {quote.clientName || "Cliente não informado"}
                        </p>
                        <Badge variant="secondary" className={info.className}>
                          {info.label}
                        </Badge>
                        {isExpirationFiltered ? (
                          <Badge
                            variant="secondary"
                            className={
                              expirationFilter === "expired"
                                ? "bg-red-500/10 text-red-700"
                                : "bg-orange-500/10 text-orange-700"
                            }
                          >
                            <CalendarDays className="mr-1 h-3 w-3" />
                            {expirationFilter === "expired"
                              ? "Vencido"
                              : "Vence hoje"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {quote.professional || "Profissional não informado"} ·
                        atualizado em {dateOnly(quote.updatedAt)}
                        {quote.validUntil
                          ? ` · validade ${dateOnly(quote.validUntil)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 md:justify-end">
                      <div className="text-left md:text-right">
                        <p className="font-display text-base font-bold">
                          {money(quote.summary.total)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {quote.rooms.length} ambiente(s)
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={duplicate.isPending}
                        onClick={() => duplicate.mutate({ id: quote.id })}
                        title="Duplicar orçamento inteiro"
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        Duplicar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setLocation(`/orcamentos/${quote.id}`)}
                      >
                        Abrir
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-bold">
                Nenhum orçamento encontrado.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ajuste os filtros ou crie uma nova proposta para a sua loja.
              </p>
              <Button
                className="mt-5"
                size="sm"
                onClick={() => create.mutate()}
              >
                <Plus className="mr-2 h-4 w-4" />
                Criar orçamento
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
