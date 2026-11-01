import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { History, Search } from "lucide-react";
import { useEffect, useState } from "react";

const ENTITY_LABELS = {
  quote: "Orçamentos",
  finance: "Financeiro",
  stock: "Estoque",
  product: "Catálogo",
  customer: "Clientes",
  message: "Mensagens",
  settings: "Configurações",
  user: "Usuários",
  auth: "Acessos",
  backup: "Backup",
} as const;
type EntityType = keyof typeof ENTITY_LABELS;

const ENTITY_STYLE: Partial<Record<EntityType, string>> = {
  finance: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  quote: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  stock: "bg-violet-500/10 text-violet-800 dark:text-violet-300",
  product: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  auth: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  backup: "bg-red-500/10 text-red-700 dark:text-red-300",
};

// Data no fuso do navegador, em "AAAA-MM-DD", como espera o <input type="date">.
const startOfInputDate = (value: string) => (value ? new Date(`${value}T00:00:00`) : undefined);
const endOfInputDate = (value: string) => {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date;
};

export function ActivityLogPanel({
  users,
}: {
  users: Array<{ id: number; name: string | null; username: string }>;
}) {
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [entityType, userId, from, to, debouncedSearch]);
  const { data, isLoading, error, refetch } = trpc.activity.list.useQuery({
    entityType: entityType || undefined,
    userId: userId ? Number(userId) : undefined,
    from: startOfInputDate(from),
    to: endOfInputDate(to),
    search: debouncedSearch || undefined,
    page,
    pageSize: 50,
  });
  const entries = data?.entries ?? [];
  const selectClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm";

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-lg">
          <History className="h-5 w-5 text-primary" />
          Registro de atividades
        </CardTitle>
        <CardDescription>
          Quem fez o quê e quando: aprovações, recebimentos e estornos, ajustes
          de estoque, preços, configurações, usuários e acessos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="activity-search">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="activity-search"
                className="pl-9"
                placeholder="Cliente, produto, número…"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-entity">Área</Label>
            <select
              id="activity-entity"
              className={selectClass}
              value={entityType}
              onChange={event => setEntityType(event.target.value as EntityType | "")}
            >
              <option value="">Todas</option>
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-user">Usuário</Label>
            <select
              id="activity-user"
              className={selectClass}
              value={userId}
              onChange={event => setUserId(event.target.value)}
            >
              <option value="">Todos</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.name || user.username}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="activity-from">De</Label>
              <Input
                id="activity-from"
                type="date"
                value={from}
                onChange={event => setFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-to">Até</Label>
              <Input
                id="activity-to"
                type="date"
                value={to}
                onChange={event => setTo(event.target.value)}
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Carregando atividades…
          </p>
        ) : error ? (
          <div role="alert" className="space-y-2 py-6 text-center text-sm text-muted-foreground">
            <p>Não foi possível carregar o registro de atividades.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : entries.length ? (
          <ol className="divide-y divide-border rounded-xl border border-border">
            {entries.map(entry => {
              const type = entry.entityType as EntityType;
              return (
                <li key={entry.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-start sm:gap-4">
                  <time
                    dateTime={new Date(entry.createdAt).toISOString()}
                    className="shrink-0 font-mono text-xs text-muted-foreground sm:w-32 sm:pt-0.5"
                  >
                    {dateTime(entry.createdAt)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{entry.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.userName || "Sistema"}
                      {entry.ip ? ` · IP ${entry.ip}` : ""}
                    </p>
                  </div>
                  <Badge variant="secondary" className={`w-fit shrink-0 ${ENTITY_STYLE[type] ?? ""}`}>
                    {ENTITY_LABELS[type] ?? entry.entityType}
                  </Badge>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhuma atividade encontrada com esses filtros.
          </p>
        )}

        {data && data.totalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {data.total} atividade(s) · página {data.page} de {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={data.page >= data.totalPages} onClick={() => setPage(data.page + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
