import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateOnly, money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { filterInventoryProducts } from "@shared/stockFilters";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardList,
  Filter,
  History,
  PackageCheck,
  PackagePlus,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type MovementForm = {
  productId: number;
  type: "entry" | "adjustment" | "return";
  quantity: number;
  responsible: string;
  notes: string;
  occurredAt: string;
};
const nowInput = () => new Date().toISOString().slice(0, 16);

const movementMeta = {
  entry: {
    label: "Entrada",
    icon: ArrowDownToLine,
    className: "bg-emerald-500/10 text-emerald-700",
  },
  delivery: {
    label: "Entrega",
    icon: ArrowUpFromLine,
    className: "bg-amber-500/10 text-amber-700",
  },
  adjustment: {
    label: "Ajuste",
    icon: SlidersHorizontal,
    className: "bg-sky-500/10 text-sky-700",
  },
  return: {
    label: "Devolução",
    icon: RotateCcw,
    className: "bg-violet-500/10 text-violet-700",
  },
} as const;

export default function InventoryPage() {
  const utils = trpc.useUtils();
  const {
    data: overview,
    isLoading,
    error: overviewError,
    refetch: refetchOverview,
  } = trpc.inventory.overview.useQuery();
  const {
    data: fulfillments = [],
    isLoading: fulfillmentsLoading,
    error: fulfillmentsError,
    refetch: refetchFulfillments,
  } = trpc.inventory.fulfillments.useQuery();
  const [movementOpen, setMovementOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<
    (typeof fulfillments)[number] | null
  >(null);
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [maximumStock, setMaximumStock] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<
    "all" | "reserved" | "low"
  >("all");
  const [movementForm, setMovementForm] = useState<MovementForm>({
    productId: 0,
    type: "entry",
    quantity: 0,
    responsible: "",
    notes: "",
    occurredAt: nowInput(),
  });
  const [deliveryForm, setDeliveryForm] = useState({
    quantity: 0,
    responsible: "",
    notes: "",
    deliveredAt: nowInput(),
  });
  const refresh = () => {
    utils.inventory.invalidate();
    utils.product.list.invalidate();
  };
  const move = trpc.inventory.move.useMutation({
    onSuccess: result => {
      refresh();
      toast.success(
        `Movimentação registrada. Saldo atual: ${result.afterQuantity}`
      );
      setMovementOpen(false);
    },
    onError: error => toast.error(error.message),
  });
  const deliver = trpc.inventory.deliver.useMutation({
    onSuccess: result => {
      refresh();
      toast.success(
        `Entrega registrada. Restam ${result.pendingQuantity} unidade(s) neste item.`
      );
      setDeliveryOpen(false);
      setSelectedLine(null);
    },
    onError: error => toast.error(error.message),
  });
  const products = overview?.products ?? [];
  const lowStock = overview?.lowStock ?? [];
  const movements = overview?.movements ?? [];
  const suppliers = overview?.suppliers ?? [];
  const pendingLines = useMemo(
    () => fulfillments.filter(line => line.pendingQuantity > 0),
    [fulfillments]
  );
  const filteredProducts = useMemo(
    () =>
      filterInventoryProducts(products, {
        supplier: supplierFilter,
        maximumStock,
        availability: availabilityFilter,
      }),
    [products, supplierFilter, maximumStock, availabilityFilter]
  );
  const openMovement = () => {
    setMovementForm({
      productId: products[0]?.id ?? 0,
      type: "entry",
      quantity: 0,
      responsible: "",
      notes: "",
      occurredAt: nowInput(),
    });
    setMovementOpen(true);
  };
  const openDelivery = (line: (typeof fulfillments)[number]) => {
    setSelectedLine(line);
    setDeliveryForm({
      quantity: Math.min(line.pendingQuantity, line.stockQuantity),
      responsible: "",
      notes: "",
      deliveredAt: nowInput(),
    });
    setDeliveryOpen(true);
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Operação e expedição</p>
          <h2 className="page-title">Estoque</h2>
          <p className="page-description">
            Controle entradas, reservas, disponibilidade e entregas parciais de
            orçamentos aprovados.
          </p>
        </div>
        <Button
          className="h-11 px-5"
          onClick={openMovement}
          disabled={!products.length}
        >
          <PackagePlus className="mr-2 h-4 w-4" />
          Movimentar estoque
        </Button>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <Boxes className="h-5 w-5 text-primary" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Itens cadastrados
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {products.length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <PackageCheck className="h-5 w-5 text-emerald-600" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Valor em estoque
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {money(overview?.stockValue)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Abaixo da reposição
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {lowStock.length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <ClipboardList className="h-5 w-5 text-amber-600" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Itens pendentes de entrega
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {pendingLines.length}
            </p>
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display text-lg">
                Saldo por produto
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Saldo disponível = físico menos o que já está reservado para
                propostas aprovadas.
              </p>
            </div>
            <Boxes className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Fornecedor
                </Label>
                <select
                  aria-label="Filtrar produtos por fornecedor"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={supplierFilter}
                  onChange={e => setSupplierFilter(e.target.value)}
                >
                  <option value="all">Todos os fornecedores</option>
                  {suppliers.map(supplier => (
                    <option key={supplier} value={supplier}>
                      {supplier}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Saldo físico até
                </Label>
                <Input
                  aria-label="Saldo físico até"
                  className="h-9"
                  type="number"
                  min="0"
                  placeholder="Ex.: 5"
                  value={maximumStock}
                  onChange={e => setMaximumStock(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Situação
                </Label>
                <select
                  aria-label="Filtrar produtos por situação"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={availabilityFilter}
                  onChange={e =>
                    setAvailabilityFilter(
                      e.target.value as typeof availabilityFilter
                    )
                  }
                >
                  <option value="all">Todos</option>
                  <option value="reserved">Com reserva ativa</option>
                  <option value="low">Abaixo da reposição</option>
                </select>
              </div>
            </div>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Carregando estoque…
              </p>
            ) : overviewError ? (
              <div
                role="alert"
                className="space-y-3 py-8 text-center text-sm text-muted-foreground"
              >
                <p>Não foi possível carregar o saldo de estoque.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchOverview()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : filteredProducts.length ? (
              <div className="divide-y divide-border">
                {filteredProducts.map(product => (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg border bg-muted">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Boxes className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        {product.shortDescription}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {product.code} ·{" "}
                        {product.supplierName || "Sem fornecedor"} · reposição:{" "}
                        {product.reorderPoint} {product.unit}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="flex justify-end gap-1">
                        <Badge
                          variant="secondary"
                          className={
                            product.lowStock
                              ? "bg-red-500/10 text-red-700"
                              : "bg-emerald-500/10 text-emerald-700"
                          }
                        >
                          Físico: {product.stockQuantity}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="bg-amber-500/10 text-amber-700"
                        >
                          Res.: {product.reservedQuantity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-primary">
                        Disponível: {product.availableQuantity} {product.unit}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center">
                <Filter className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-semibold">
                  Nenhum produto corresponde aos filtros.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-lg">
              Reposição necessária
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Itens cujo saldo físico atingiu o ponto de reposição.
            </p>
          </CardHeader>
          <CardContent>
            {lowStock.length ? (
              <div className="space-y-3">
                {lowStock.map(product => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between rounded-xl border border-red-500/15 bg-red-500/5 p-3"
                  >
                    <div>
                      <p className="text-sm font-bold">
                        {product.shortDescription}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {product.supplierName || "Fornecedor não informado"} ·
                        mínimo: {product.reorderPoint} {product.unit}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-red-500/10 text-red-700"
                    >
                      {product.stockQuantity} {product.unit}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center">
                <PackageCheck className="mx-auto h-7 w-7 text-emerald-600" />
                <p className="mt-3 text-sm font-semibold">
                  Todos os itens estão acima da reposição.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      <section>
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display text-lg">
                Entregas parciais de orçamentos aprovados
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Aprovar a proposta cria uma reserva. Cada retirada consome a
                reserva e reduz o saldo físico.
              </p>
            </div>
            <PackageCheck className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            {fulfillmentsLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Carregando entregas…
              </p>
            ) : fulfillmentsError ? (
              <div
                role="alert"
                className="space-y-3 py-8 text-center text-sm text-muted-foreground"
              >
                <p>Não foi possível carregar as entregas pendentes.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchFulfillments()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : pendingLines.length ? (
              <div className="divide-y divide-border">
                {pendingLines.map(line => (
                  <div
                    key={line.quoteItemId}
                    className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 font-display text-sm font-bold text-amber-700">
                      #{line.quoteNumber}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">
                        {line.shortDescription}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {line.clientName || "Cliente não informado"} ·{" "}
                        {line.roomName} · pedido: {line.orderedQuantity}{" "}
                        {line.unit}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <Badge
                          variant="secondary"
                          className="bg-sky-500/10 text-sky-700"
                        >
                          Entregue: {line.deliveredQuantity}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="bg-amber-500/10 text-amber-700"
                        >
                          Reservado: {line.reservedQuantity}
                        </Badge>
                        <Badge variant="secondary">
                          Físico: {line.stockQuantity}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-700"
                        >
                          Disponível: {line.availableQuantity}
                        </Badge>
                      </div>
                      {line.deliveries.length ? (
                        <details className="mt-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">
                            Ver {line.deliveries.length} entrega(s)
                            registrada(s)
                          </summary>
                          <div className="mt-2 space-y-1 rounded-lg bg-muted/50 p-2">
                            {line.deliveries.map(delivery => (
                              <p key={delivery.id}>
                                {dateOnly(delivery.deliveredAt)} ·{" "}
                                {delivery.deliveredQuantity} {line.unit}
                                {delivery.responsible
                                  ? ` · ${delivery.responsible}`
                                  : ""}
                              </p>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      disabled={
                        line.stockQuantity <= 0 || line.reservedQuantity <= 0
                      }
                      onClick={() => openDelivery(line)}
                    >
                      <ArrowUpFromLine className="mr-2 h-4 w-4" />
                      Registrar entrega
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center">
                <PackageCheck className="mx-auto h-7 w-7 text-emerald-600" />
                <p className="mt-3 text-sm font-semibold">
                  Não há itens pendentes de entrega.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Aprovar um orçamento com produtos vinculados ao catálogo fará
                  os itens aparecerem aqui.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      <section>
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display text-lg">
                Histórico de movimentações
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Últimas 100 entradas, entregas, ajustes e devoluções registrados
                no estoque.
              </p>
            </div>
            <History className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            {movements.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-sm">
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
                    {movements.map(movement => {
                      const meta = movementMeta[movement.type];
                      const Icon = meta.icon;
                      return (
                        <tr
                          key={movement.id}
                          className="border-b border-border/70 last:border-0"
                        >
                          <td className="py-3 text-xs">
                            {dateOnly(movement.occurredAt)}
                          </td>
                          <td className="py-3">
                            <p className="font-semibold">
                              {movement.product?.shortDescription ||
                                "Produto removido"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {movement.product?.code}
                            </p>
                          </td>
                          <td className="py-3">
                            <Badge
                              variant="secondary"
                              className={meta.className}
                            >
                              <Icon className="mr-1 h-3 w-3" />
                              {meta.label}
                            </Badge>
                          </td>
                          <td className="py-3 font-semibold">
                            {movement.quantity > 0 ? "+" : ""}
                            {movement.quantity}
                          </td>
                          <td className="py-3 text-xs">
                            {movement.beforeQuantity} → {movement.afterQuantity}
                          </td>
                          <td className="py-3 text-xs text-muted-foreground">
                            {movement.clientName ||
                              movement.responsible ||
                              "Movimentação interna"}
                            {movement.responsible && movement.clientName
                              ? ` · ${movement.responsible}`
                              : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center">
                <History className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-semibold">
                  Ainda não há movimentações.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      <Dialog open={movementOpen} onOpenChange={setMovementOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Movimentar estoque</DialogTitle>
            <DialogDescription>
              Entradas, ajustes e devoluções ficam registrados no histórico do
              produto.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Produto</Label>
              <select
                aria-label="Produto da movimentação"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={movementForm.productId}
                onChange={e =>
                  setMovementForm({
                    ...movementForm,
                    productId: Number(e.target.value),
                  })
                }
              >
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.code} · {product.shortDescription}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <select
                  aria-label="Tipo de movimentação de estoque"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={movementForm.type}
                  onChange={e =>
                    setMovementForm({
                      ...movementForm,
                      type: e.target.value as MovementForm["type"],
                    })
                  }
                >
                  <option value="entry">Entrada</option>
                  <option value="adjustment">Ajuste</option>
                  <option value="return">Devolução</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>
                  {movementForm.type === "adjustment"
                    ? "Quantidade (+/-)"
                    : "Quantidade"}
                </Label>
                <Input
                  aria-label={movementForm.type === "adjustment" ? "Quantidade (+/-)" : "Quantidade"}
                  type="number"
                  step="0.01"
                  value={movementForm.quantity}
                  onChange={e =>
                    setMovementForm({
                      ...movementForm,
                      quantity: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Input
                aria-label="Responsável"
                value={movementForm.responsible}
                onChange={e =>
                  setMovementForm({
                    ...movementForm,
                    responsible: e.target.value,
                  })
                }
                placeholder="Quem registrou a movimentação"
              />
            </div>
            <div className="space-y-2">
              <Label>Data e hora</Label>
              <Input
                aria-label="Data e hora"
                type="datetime-local"
                value={movementForm.occurredAt}
                onChange={e =>
                  setMovementForm({
                    ...movementForm,
                    occurredAt: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea
                aria-label="Observação"
                rows={2}
                value={movementForm.notes}
                onChange={e =>
                  setMovementForm({ ...movementForm, notes: e.target.value })
                }
                placeholder="Ex.: recebimento do fornecedor"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMovementOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={
                move.isPending ||
                !movementForm.productId ||
                !movementForm.quantity
              }
              onClick={() =>
                move.mutate({
                  ...movementForm,
                  occurredAt: new Date(movementForm.occurredAt),
                })
              }
            >
              Registrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deliveryOpen}
        onOpenChange={value => {
          setDeliveryOpen(value);
          if (!value) setSelectedLine(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar entrega parcial</DialogTitle>
            <DialogDescription>
              {selectedLine
                ? `Orçamento #${selectedLine.quoteNumber} · ${selectedLine.clientName || "Cliente não informado"}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedLine ? (
            <div className="space-y-4 py-2">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="font-semibold">{selectedLine.shortDescription}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Reservado: {selectedLine.reservedQuantity} {selectedLine.unit}{" "}
                  · Físico: {selectedLine.stockQuantity} {selectedLine.unit}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Quantidade entregue</Label>
                <Input
                  aria-label="Quantidade entregue"
                  type="number"
                  min="0.01"
                  max={Math.min(
                    selectedLine.reservedQuantity,
                    selectedLine.stockQuantity
                  )}
                  step="0.01"
                  value={deliveryForm.quantity}
                  onChange={e =>
                    setDeliveryForm({
                      ...deliveryForm,
                      quantity: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Responsável pela entrega</Label>
                <Input
                  aria-label="Responsável pela entrega"
                  value={deliveryForm.responsible}
                  onChange={e =>
                    setDeliveryForm({
                      ...deliveryForm,
                      responsible: e.target.value,
                    })
                  }
                  placeholder="Ex.: equipe de expedição"
                />
              </div>
              <div className="space-y-2">
                <Label>Data e hora da entrega</Label>
                <Input
                  aria-label="Data e hora da entrega"
                  type="datetime-local"
                  value={deliveryForm.deliveredAt}
                  onChange={e =>
                    setDeliveryForm({
                      ...deliveryForm,
                      deliveredAt: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Observação</Label>
                <Textarea
                  aria-label="Observação da entrega"
                  rows={2}
                  value={deliveryForm.notes}
                  onChange={e =>
                    setDeliveryForm({ ...deliveryForm, notes: e.target.value })
                  }
                  placeholder="Ex.: retirada pelo cliente"
                />
              </div>
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                Esta operação consome a reserva, reduz o estoque físico e mantém
                o restante do item como pendente de entrega.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeliveryOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={
                deliver.isPending ||
                !selectedLine ||
                !deliveryForm.quantity ||
                deliveryForm.quantity >
                  Math.min(
                    selectedLine.reservedQuantity,
                    selectedLine.stockQuantity
                  )
              }
              onClick={() =>
                selectedLine &&
                deliver.mutate({
                  quoteId: selectedLine.quoteId,
                  quoteItemId: selectedLine.quoteItemId,
                  quantity: deliveryForm.quantity,
                  responsible: deliveryForm.responsible || null,
                  notes: deliveryForm.notes || null,
                  deliveredAt: new Date(deliveryForm.deliveredAt),
                })
              }
            >
              Confirmar retirada
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
