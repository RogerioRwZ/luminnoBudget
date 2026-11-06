import { Badge } from "@/components/ui/badge";
import {
  AsyncButton,
  FormError,
  getFormErrorMessage,
} from "@/components/FormFeedback";
import { DraftAutosaveStatus } from "@/components/DraftAutosaveStatus";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
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
import { ScanButton } from "@/components/CameraBarcodeScanner";
import { useUnknownCode } from "@/hooks/useUnknownCode";
import { findProductByScan, foldText, matchesProductSearch } from "@shared/productCodes";
import { downloadCsv } from "@/lib/csvDownload";
import { filterInventoryProducts } from "@shared/stockFilters";
import {
  Download,
  AlertTriangle,
  ArrowUpFromLine,
  Boxes,
  ClipboardList,
  Filter,
  PackageCheck,
  PackagePlus,
  ScanBarcode,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { ShowMoreButton } from "@/components/ShowMoreButton";
import { StockHistoryCard } from "@/components/StockHistoryCard";
import { useDeliveryReceipt } from "@/hooks/useDeliveryReceipt";
import { useVisibleItems } from "@/hooks/useVisibleItems";
import { toast } from "sonner";
import { plural } from "@shared/plural";

type MovementForm = {
  productId: number;
  type: "entry" | "adjustment" | "return";
  quantity: number;
  notes: string;
  occurredAt: string;
};
// Data e hora locais: toISOString é UTC e adiantaria o campo em 3 horas.
// Listas do Estoque: 10 linhas por vez.
const STOCK_PAGE = 10;
const qty = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const nowInput = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function InventoryPage() {
  const utils = trpc.useUtils();
  const {
    data: overview,
    isLoading,
    error: overviewError,
    refetch: refetchOverview,
  } = trpc.inventory.overview.useQuery();
  const { data: authStatus } = trpc.auth.status.useQuery(undefined, { staleTime: Infinity });
  const currentUserName = authStatus?.user?.name || authStatus?.user?.username || "";
  const {
    data: fulfillments = [],
    isLoading: fulfillmentsLoading,
    error: fulfillmentsError,
    refetch: refetchFulfillments,
  } = trpc.inventory.fulfillments.useQuery();
  const [movementOpen, setMovementOpen] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<
    (typeof fulfillments)[number] | null
  >(null);
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [productSearch, setProductSearch] = useState("");
  const unknownCode = useUnknownCode();
  const [maximumStock, setMaximumStock] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<
    "all" | "reserved" | "low"
  >("all");
  const movementOptions = useMemo(() => (overview?.products ?? []).map(product => ({
    value: String(product.id),
    label: `${product.reference ?? product.code} · ${product.shortDescription}`,
    hint: `Físico: ${qty(product.stockQuantity)} ${product.unit} · Disponível: ${qty(product.availableQuantity)}${product.active ? "" : " · Arquivado"}`,
    searchText: `${product.code} ${product.barcode ?? ""} ${product.fullDescription ?? ""} ${product.supplierName ?? ""}`,
  })), [overview?.products]);
  const [movementForm, setMovementForm] = useState<MovementForm>({
    productId: 0,
    type: "entry",
    quantity: 0,
    notes: "",
    occurredAt: nowInput(),
  });
  const [deliveryForm, setDeliveryForm] = useState({
    quantity: 0,
    responsible: "",
    notes: "",
    deliveredAt: nowInput(),
  });
  const movementDraft = useDraftAutosave("inventory-movement", movementForm, {
    enabled: movementOpen,
  });
  const deliveryDraft = useDraftAutosave("inventory-delivery", deliveryForm, {
    enabled: deliveryOpen,
  });
  const refresh = () => {
    utils.inventory.invalidate();
    utils.product.list.invalidate();
  };
  const move = trpc.inventory.move.useMutation({
    onSuccess: result => {
      refresh();
      toast.success(
        `Movimentação registrada. Saldo atual: ${qty(result.afterQuantity)}`
      );
      setInventoryError("");
      setMovementOpen(false);
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível registrar a movimentação. Confira produto, quantidade e data e tente novamente."
      );
      setInventoryError(message);
      toast.error(message);
    },
  });
  const printReceipt = useDeliveryReceipt();
  const deliver = trpc.inventory.deliver.useMutation({
    onSuccess: (result, input) => {
      refresh();
      toast.success(
        result.pendingQuantity > 0
          ? `Retirada registrada. Faltam ${result.pendingQuantity.toLocaleString("pt-BR")} neste item.`
          : "Retirada registrada. Item entregue por completo.",
        { duration: 10_000, action: { label: "Comprovante", onClick: () => printReceipt(input.quoteId, result.deliveryId) } }
      );
      setDeliveryOpen(false);
      setSelectedLine(null);
      setInventoryError("");
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível registrar a entrega. Confira a quantidade disponível e tente novamente."
      );
      setInventoryError(message);
      toast.error(message);
    },
  });
  const products = overview?.products ?? [];
  const lowStock = overview?.lowStock ?? [];
  const suppliers = overview?.suppliers ?? [];
  const [lowStockSearch, setLowStockSearch] = useState("");
  const filteredLowStock = useMemo(() => lowStock.filter(product => matchesProductSearch(product, lowStockSearch)), [lowStock, lowStockSearch]);
  const { visible: visibleLowStock, remaining: remainingLowStock, showMore: showMoreLowStock } = useVisibleItems(filteredLowStock, `${lowStock.length}|${lowStockSearch}`, STOCK_PAGE);
  // Itens agrupados por orçamento, para retirar tudo de uma vez ou conferir
  // com o leitor. O que já terminou segue visível, para consulta e estorno.
  const fulfillmentGroups = useMemo(() => {
    const groups = new Map<
      number,
      {
        quoteId: number;
        quoteNumber: number;
        clientName: string;
        lines: typeof fulfillments;
      }
    >();
    fulfillments.forEach(line => {
      const group = groups.get(line.quoteId) ?? {
        quoteId: line.quoteId,
        quoteNumber: line.quoteNumber,
        clientName: line.clientName,
        lines: [],
      };
      group.lines.push(line);
      groups.set(line.quoteId, group);
    });
    return Array.from(groups.values()).map(group => {
      const pendingLines = group.lines.filter(line => line.pendingQuantity > 0);
      return {
        ...group,
        pendingLines,
        deliverableCount: pendingLines.filter(line => line.deliverableQuantity > 0).length,
        shortageCount: pendingLines.filter(line => line.shortageQuantity > 0).length,
      };
    });
  }, [fulfillments]);
  const pendingQuotes = useMemo(() => fulfillmentGroups.filter(group => group.pendingLines.length > 0), [fulfillmentGroups]);
  const finishedQuotes = useMemo(() => fulfillmentGroups.filter(group => !group.pendingLines.length), [fulfillmentGroups]);
  const [fulfillmentTab, setFulfillmentTab] = useState<"pending" | "finished">("pending");
  const [fulfillmentSearch, setFulfillmentSearch] = useState("");
  const visibleGroups = useMemo(() => {
    const words = foldText(fulfillmentSearch).split(/\s+/).filter(Boolean);
    return (fulfillmentTab === "pending" ? pendingQuotes : finishedQuotes).filter(group => {
      const text = foldText(`#${group.quoteNumber} ${group.clientName} ${group.lines.map(line => `${line.reference ?? ""} ${line.code ?? ""} ${line.barcode ?? ""} ${line.shortDescription} ${line.fullDescription ?? ""}`).join(" ")}`);
      return words.every(word => text.includes(word));
    });
  }, [fulfillmentSearch, fulfillmentTab, finishedQuotes, pendingQuotes]);
  const { visible: shownGroups, remaining: remainingGroups, showMore: showMoreGroups } = useVisibleItems(visibleGroups, `${fulfillmentTab}|${fulfillmentSearch}`, STOCK_PAGE);
  const [cancelForm, setCancelForm] = useState<{
    title: string;
    lines: Array<{ line: (typeof fulfillments)[number]; quantity: string }>;
    reason: string;
  } | null>(null);
  const [reverseForm, setReverseForm] = useState<{
    line: (typeof fulfillments)[number];
    delivery: (typeof fulfillments)[number]["deliveries"][number];
    reason: string;
  } | null>(null);
  const [undoTarget, setUndoTarget] = useState<{ id: number; label: string } | null>(null);
  const [correctionError, setCorrectionError] = useState("");
  const correctionFailed = (fallback: string) => (error: { message: string }) => setCorrectionError(getFormErrorMessage(error, fallback));
  const cancelRemainder = trpc.inventory.cancelRemainder.useMutation({
    onSuccess: () => {
      refresh();
      setCancelForm(null);
      toast.success("Saldo cancelado. Confira a cobrança no Financeiro.");
    },
    onError: correctionFailed("Não foi possível cancelar o saldo. Atualize a página e tente novamente."),
  });
  const undoCancellation = trpc.inventory.undoCancellation.useMutation({
    onSuccess: () => {
      refresh();
      setUndoTarget(null);
      toast.success("Cancelamento desfeito. O item voltou a ficar pendente.");
    },
    onError: error => {
      setUndoTarget(null);
      toast.error(getFormErrorMessage(error, "Não foi possível desfazer o cancelamento."));
    },
  });
  const reverseDelivery = trpc.inventory.reverseDelivery.useMutation({
    onSuccess: () => {
      refresh();
      setReverseForm(null);
      toast.success("Retirada estornada. O item voltou a ficar pendente.");
    },
    onError: correctionFailed("Não foi possível estornar a retirada. Atualize a página e tente novamente."),
  });
  const cancelQuantity = (value: string) => Number(value.replace(",", "."));
  const cancelAmount = cancelForm ? cancelForm.lines.reduce((sum, entry) => sum + (cancelQuantity(entry.quantity) || 0) * entry.line.unitPrice, 0) : 0;
  const cancelValid = Boolean(cancelForm && cancelForm.reason.trim().length >= 3 && cancelForm.lines.every(entry => cancelQuantity(entry.quantity) > 0 && cancelQuantity(entry.quantity) <= entry.line.pendingQuantity));
  const openCancel = (title: string, lines: typeof fulfillments) => {
    setCorrectionError("");
    setCancelForm({ title, lines: lines.map(line => ({ line, quantity: String(line.pendingQuantity) })), reason: "" });
  };
  const [deliverAllGroup, setDeliverAllGroup] = useState<
    (typeof pendingQuotes)[number] | null
  >(null);
  const deliverAll = trpc.inventory.deliverAll.useMutation({
    onSuccess: (results, input) => {
      refresh();
      setDeliverAllGroup(null);
      toast.success(
        `Retirada registrada: ${plural(results.length, "item", "itens")}.`,
        { duration: 10_000, action: { label: "Comprovante", onClick: () => printReceipt(input.quoteId, results[0]!.deliveryId) } }
      );
    },
    onError: error => {
      setDeliverAllGroup(null);
      toast.error(
        getFormErrorMessage(
          error,
          "Não foi possível registrar a retirada. Atualize a página e tente novamente."
        )
      );
    },
  });
  const filteredProducts = useMemo(
    () =>
      filterInventoryProducts(products, {
        supplier: supplierFilter,
        maximumStock,
        availability: availabilityFilter,
      }).filter(product => matchesProductSearch(product, productSearch)),
    [products, supplierFilter, maximumStock, availabilityFilter, productSearch]
  );
  const { visible: visibleProducts, remaining: remainingProducts, showMore: showMoreProducts } = useVisibleItems(filteredProducts, filteredProducts.length, STOCK_PAGE);
  const movementProduct = products.find(product => product.id === movementForm.productId);
  const movementAfter = movementProduct && movementForm.quantity
    ? Math.round((movementProduct.stockQuantity + (movementForm.type === "adjustment" ? movementForm.quantity : Math.abs(movementForm.quantity))) * 100) / 100
    : null;
  const openMovement = (productId = 0) => {
    setMovementForm({
      productId,
      type: "entry",
      quantity: 0,
      notes: "",
      occurredAt: nowInput(),
    });
    setMovementOpen(true);
  };
  const openDelivery = (line: (typeof fulfillments)[number]) => {
    setSelectedLine(line);
    setDeliveryForm({
      // O que este item pode retirar agora: pendente, limitado à reserva
      // dele e ao estoque físico (itens avulsos: todo o pendente).
      quantity: line.deliverableQuantity,
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
          <h2 className="page-title flex flex-wrap items-center gap-3">
            Estoque{" "}
            <DraftAutosaveStatus
              status={
                movementOpen ? movementDraft.status : deliveryDraft.status
              }
            />
          </h2>
          <p className="page-description">
            Controle entradas, reservas, disponibilidade e entregas parciais de
            orçamentos aprovados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-11 px-4">
            <Link href="/estoque/giro">
              <TrendingUp className="mr-2 h-4 w-4" />
              Giro e curva ABC
            </Link>
          </Button>
          <Button
            variant="outline"
            className="h-11 px-4"
            disabled={!products.length}
            onClick={() =>
              downloadCsv("estoque", products, [
                { header: "Referência", value: product => product.reference ?? product.code },
                { header: "Código", value: product => product.code },
                { header: "Produto", value: product => product.shortDescription },
                { header: "Fornecedor", value: product => product.supplierName },
                { header: "Unidade", value: product => product.unit },
                { header: "Saldo", value: product => product.stockQuantity },
                { header: "Reservado", value: product => product.reservedQuantity },
                { header: "Disponível", value: product => product.availableQuantity },
                { header: "Ponto de reposição", value: product => product.reorderPoint },
                { header: "Preço unitário", value: product => product.unitPrice },
                { header: "Valor em estoque", value: product => product.stockQuantity * product.unitPrice },
                { header: "Estoque baixo", value: product => product.lowStock },
              ])
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          <Button
            className="h-11 px-5"
            onClick={() => openMovement()}
            disabled={!products.length}
          >
            <PackagePlus className="mr-2 h-4 w-4" />
            Movimentar estoque
          </Button>
        </div>
      </div>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <PackageCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
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
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-300" />
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
            <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">
              Itens pendentes de entrega
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {pendingQuotes.reduce((sum, group) => sum + group.pendingLines.length, 0)}
            </p>
          </CardContent>
        </Card>
      </section>
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
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
            <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-3">
                <Label htmlFor="inventory-search" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Produto
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="inventory-search"
                    className="h-9"
                    placeholder="Referência, descrição ou código de barras"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                  />
                  <ScanButton className="h-9 w-9 shrink-0" title="Buscar no estoque pelo código de barras" onDetected={value => {
                    setProductSearch(value);
                    if (!findProductByScan(products, value)) unknownCode(value);
                  }} />
                </div>
              </div>
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
            <>
              <div className="divide-y divide-border">
                {visibleProducts.map(product => (
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
                        Ref. {product.reference ?? product.code} ·{" "}
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
                              ? "bg-red-500/10 text-red-700 dark:text-red-300"
                              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          }
                        >
                          Físico: {qty(product.stockQuantity)}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        >
                          Res.: {qty(product.reservedQuantity)}
                        </Badge>
                        {product.loanedQuantity ? (
                          <Badge variant="secondary" className="bg-violet-500/10 text-violet-700 dark:text-violet-300" title="Fora da loja, no mostruário">
                            Emprest.: {product.loanedQuantity}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs font-semibold text-primary">
                        Disponível: {qty(product.availableQuantity)} {product.unit}
                      </p>
                      <button type="button" className="mt-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" aria-label={`Movimentar ${product.shortDescription}`} onClick={() => openMovement(product.id)}>
                        Movimentar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <ShowMoreButton remaining={remainingProducts} onClick={showMoreProducts} />
            </>
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
                <SearchInput ariaLabel="Buscar na reposição necessária" placeholder="Produto, referência ou fornecedor" value={lowStockSearch} onChange={setLowStockSearch} />
                {!filteredLowStock.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum item encontrado nesta lista.</p> : null}
                {visibleLowStock.map(product => (
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
                      className="bg-red-500/10 text-red-700 dark:text-red-300"
                    >
                      {qty(product.stockQuantity)} {product.unit}
                    </Badge>
                  </div>
                ))}
                <ShowMoreButton remaining={remainingLowStock} onClick={showMoreLowStock} />
              </div>
            ) : (
              <div className="py-10 text-center">
                <PackageCheck className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-300" />
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
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="font-display text-lg">
                Retiradas de orçamentos aprovados
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Aprovar reserva o estoque disponível; o que faltar aparece em
                Compras. Cada retirada, total ou parcial, consome a reserva e
                baixa o estoque.
              </p>
            </div>
            <PackageCheck className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            {fulfillmentsLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Carregando retiradas…
              </p>
            ) : fulfillmentsError ? (
              <div
                role="alert"
                className="space-y-3 py-8 text-center text-sm text-muted-foreground"
              >
                <p>Não foi possível carregar as retiradas pendentes.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchFulfillments()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex gap-2" role="tablist" aria-label="Retiradas">
                    {([["pending", `Com saldo (${pendingQuotes.length})`], ["finished", `Concluídos (${finishedQuotes.length})`]] as const).map(([value, label]) => (
                      <Button key={value} role="tab" aria-selected={fulfillmentTab === value} size="sm" variant={fulfillmentTab === value ? "default" : "outline"} onClick={() => setFulfillmentTab(value)}>
                        {label}
                      </Button>
                    ))}
                  </div>
                  <Input
                    aria-label="Buscar retirada por cliente, orçamento ou produto"
                    className="sm:ml-auto sm:max-w-xs"
                    placeholder="Cliente, nº do orçamento ou produto"
                    value={fulfillmentSearch}
                    onChange={event => setFulfillmentSearch(event.target.value)}
                  />
                </div>
                {shownGroups.map(group => (
                  <div
                    key={group.quoteId}
                    className="overflow-hidden rounded-xl border border-border/70"
                  >
                    <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/30 p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold">
                          Orçamento #{group.quoteNumber} ·{" "}
                          {group.clientName || "Cliente não informado"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {group.pendingLines.length
                            ? plural(group.pendingLines.length, "item pendente", "itens pendentes")
                            : "Nada pendente"}
                          {group.shortageCount
                            ? ` · ${plural(group.shortageCount, "aguardando compra", "aguardando compra")}`
                            : ""}
                        </p>
                      </div>
                      {group.pendingLines.length ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openCancel(`Cancelar todo o saldo do orçamento #${group.quoteNumber}`, group.pendingLines)}>
                            Cancelar saldo
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/estoque/conferencia/${group.quoteId}`}>
                              <ScanBarcode className="mr-2 h-4 w-4" />
                              Conferir com leitor
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            disabled={!group.deliverableCount}
                            onClick={() => setDeliverAllGroup(group)}
                          >
                            <PackageCheck className="mr-2 h-4 w-4" />
                            Retirar tudo
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="divide-y divide-border">
                      {group.lines.map(line => (
                        <div
                          key={line.quoteItemId}
                          className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold">
                              {line.shortDescription}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {line.roomName} · entregue{" "}
                              {qty(line.deliveredQuantity)} de {qty(line.orderedQuantity)}{" "}
                              {line.unit}
                              {line.cancelledQuantity ? ` · ${qty(line.cancelledQuantity)} cancelado` : ""}
                            </p>
                            {line.pendingQuantity > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                {line.productId ? (
                                  <Badge
                                    variant="secondary"
                                    className="bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  >
                                    Reservado: {qty(line.reservedQuantity)}
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    Item avulso, sem estoque
                                  </Badge>
                                )}
                                <Badge
                                  variant="secondary"
                                  className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                >
                                  Pode retirar: {qty(line.deliverableQuantity)}
                                </Badge>
                                {line.shortageQuantity > 0 ? (
                                  <Badge
                                    variant="secondary"
                                    className="bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                  >
                                    <ShoppingCart className="mr-1 h-3 w-3" />
                                    Falta comprar: {qty(line.shortageQuantity)}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : null}
                            {line.deliveries.length || line.cancellations.length ? (
                              <details className="mt-2 text-xs text-muted-foreground">
                                <summary className="cursor-pointer">
                                  Ver histórico ({line.deliveries.length + line.cancellations.length})
                                </summary>
                                <div className="mt-2 space-y-1 rounded-lg bg-muted/50 p-2">
                                  {line.deliveries.map(delivery => (
                                    <div key={`d${delivery.id}`} className="flex flex-wrap items-center gap-2">
                                      <p className={delivery.reversedAt ? "line-through" : ""}>
                                        Retirada: {dateOnly(delivery.deliveredAt)} ·{" "}
                                        {qty(delivery.deliveredQuantity)} {line.unit}
                                        {delivery.responsible
                                          ? ` · ${delivery.responsible}`
                                          : ""}
                                      </p>
                                      {delivery.reversedAt ? null : (
                                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => printReceipt(line.quoteId, delivery.id)}>
                                          Comprovante
                                        </Button>
                                      )}
                                      {delivery.reversedAt ? (
                                        <span>Estornada em {dateOnly(delivery.reversedAt)}: {delivery.reversalReason}</span>
                                      ) : (
                                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { setCorrectionError(""); setReverseForm({ line, delivery, reason: "" }); }}>
                                          Estornar
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                  {line.cancellations.map(cancellation => (
                                    <div key={`c${cancellation.id}`} className="flex flex-wrap items-center gap-2">
                                      <p className={cancellation.undoneAt ? "line-through" : ""}>
                                        Saldo cancelado: {dateOnly(cancellation.cancelledAt)} ·{" "}
                                        {qty(cancellation.quantity)} {line.unit} · {cancellation.reason}
                                      </p>
                                      {cancellation.undoneAt ? (
                                        <span>Desfeito em {dateOnly(cancellation.undoneAt)}</span>
                                      ) : (
                                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setUndoTarget({ id: cancellation.id, label: `${qty(cancellation.quantity)} ${line.unit} de ${line.shortDescription}` })}>
                                          Desfazer
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ) : null}
                          </div>
                          {line.pendingQuantity > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="ghost" onClick={() => openCancel(`Cancelar saldo de ${line.shortDescription}`, [line])}>
                                Cancelar saldo
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={line.deliverableQuantity <= 0}
                                onClick={() => openDelivery(line)}
                              >
                                <ArrowUpFromLine className="mr-2 h-4 w-4" />
                                Registrar retirada
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <ShowMoreButton remaining={remainingGroups} onClick={showMoreGroups} />
                {!visibleGroups.length ? (
                  <div className="py-10 text-center">
                    <PackageCheck className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-300" />
                    <p className="mt-3 text-sm font-semibold">
                      {fulfillmentSearch.trim()
                        ? "Nenhum orçamento encontrado nesta lista."
                        : fulfillmentTab === "pending"
                          ? "Não há itens pendentes de retirada."
                          : "Nenhum orçamento concluído ainda."}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Os itens de orçamentos aprovados aparecem aqui até serem
                      entregues por completo.
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      <Dialog open={Boolean(cancelForm)} onOpenChange={open => !open && setCancelForm(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{cancelForm?.title}</DialogTitle>
            <DialogDescription>
              Para o que o cliente não vai mais retirar. O saldo sai de
              Retiradas, Separação e Compras, e a reserva fica livre.
            </DialogDescription>
          </DialogHeader>
          <FormError message={correctionError} />
          {cancelForm ? (
            <div className="space-y-4">
              {cancelForm.lines.map((entry, index) => (
                <div key={entry.line.quoteItemId} className="flex items-end gap-3">
                  <p className="min-w-0 flex-1 text-sm">
                    <b className="block truncate">{entry.line.shortDescription}</b>
                    <span className="text-xs text-muted-foreground">{entry.line.roomName} · pendente: {qty(entry.line.pendingQuantity)} {entry.line.unit}</span>
                  </p>
                  <Input
                    aria-label={`Quantidade a cancelar de ${entry.line.shortDescription}`}
                    className="w-24"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={entry.line.pendingQuantity}
                    value={entry.quantity}
                    onChange={event => setCancelForm({ ...cancelForm, lines: cancelForm.lines.map((other, otherIndex) => (otherIndex === index ? { ...other, quantity: event.target.value } : other)) })}
                  />
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor="cancel-reason">Motivo *</Label>
                <Textarea id="cancel-reason" rows={2} placeholder="Ex.: cliente desistiu do restante" value={cancelForm.reason} onChange={event => setCancelForm({ ...cancelForm, reason: event.target.value })} />
              </div>
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                Valor dos itens cancelados: <b>{money(cancelAmount)}</b>, sem
                considerar desconto e frete. O Financeiro não muda sozinho:
                estorne ou cancele a cobrança lá, se for o caso.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCancelForm(null)}>Voltar</Button>
                <AsyncButton
                  pending={cancelRemainder.isPending}
                  loadingLabel="Cancelando…"
                  disabled={!cancelValid}
                  onClick={() => cancelRemainder.mutate({
                    quoteId: cancelForm.lines[0]!.line.quoteId,
                    reason: cancelForm.reason,
                    lines: cancelForm.lines.map(entry => ({ quoteItemId: entry.line.quoteItemId, quantity: cancelQuantity(entry.quantity) })),
                  })}
                >
                  Cancelar saldo
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(reverseForm)} onOpenChange={open => !open && setReverseForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Estornar retirada</DialogTitle>
            <DialogDescription>
              {reverseForm ? `${reverseForm.delivery.deliveredQuantity} ${reverseForm.line.unit} de ${reverseForm.line.shortDescription}, retirada em ${dateOnly(reverseForm.delivery.deliveredAt)}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <FormError message={correctionError} />
          {reverseForm ? (
            <div className="space-y-4">
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                {reverseForm.line.productId
                  ? "Para retirada lançada por engano: a peça volta ao estoque e o item volta a ficar pendente. Se o cliente levou e devolveu, use o Pós-venda."
                  : "Para retirada lançada por engano: o item volta a ficar pendente. Se o cliente levou e devolveu, use o Pós-venda."}
              </p>
              <div className="space-y-2">
                <Label htmlFor="reverse-reason">Motivo *</Label>
                <Textarea id="reverse-reason" rows={2} placeholder="Ex.: lançada no orçamento errado" value={reverseForm.reason} onChange={event => setReverseForm({ ...reverseForm, reason: event.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReverseForm(null)}>Voltar</Button>
                <AsyncButton
                  pending={reverseDelivery.isPending}
                  loadingLabel="Estornando…"
                  disabled={reverseForm.reason.trim().length < 3}
                  onClick={() => reverseDelivery.mutate({ deliveryId: reverseForm.delivery.id, reason: reverseForm.reason })}
                >
                  Estornar retirada
                </AsyncButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={undoTarget !== null}
        onOpenChange={open => !open && setUndoTarget(null)}
        title="Desfazer o cancelamento?"
        description={undoTarget ? `${undoTarget.label} volta a ficar pendente e reserva o que houver livre no estoque.` : ""}
        confirmLabel="Desfazer cancelamento"
        onConfirm={() => undoTarget && undoCancellation.mutate({ id: undoTarget.id })}
      />
      <ConfirmDialog
        open={deliverAllGroup !== null}
        onOpenChange={open => !open && setDeliverAllGroup(null)}
        title={`Retirar tudo do orçamento #${deliverAllGroup?.quoteNumber ?? ""}?`}
        description={
          deliverAllGroup
            ? `Registra agora a retirada de ${plural(deliverAllGroup.deliverableCount, "item disponível", "itens disponíveis")}${deliverAllGroup.shortageCount ? ". Itens que aguardam compra ficam pendentes" : ""}. O estoque é baixado na hora.`
            : ""
        }
        confirmLabel="Registrar retirada"
        onConfirm={() =>
          deliverAllGroup &&
          deliverAll.mutate({
            quoteId: deliverAllGroup.quoteId,
            deliveredAt: new Date(),
            responsible: null,
            notes: null,
          })
        }
      />
      <section>
        <StockHistoryCard />
      </section>
      <Dialog open={movementOpen} onOpenChange={setMovementOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Movimentar estoque</DialogTitle>
            <DialogDescription>
              Entradas, ajustes e devoluções ficam registrados no histórico do
              produto.
            </DialogDescription>
          </DialogHeader>
          <FormError message={inventoryError} />
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Produto</Label>
              <SearchableSelect
                ariaLabel="Produto da movimentação"
                placeholder="Referência, descrição ou código de barras"
                value={movementForm.productId ? String(movementForm.productId) : ""}
                options={movementOptions}
                emptyMessage="Nenhum produto encontrado."
                onChange={value => setMovementForm(current => ({ ...current, productId: Number(value) }))}
                action={
                  <ScanButton
                    className="h-10 w-10 shrink-0"
                    title="Escolher o produto pelo código de barras"
                    onDetected={value => {
                      const found = findProductByScan(products, value);
                      if (found) setMovementForm(current => ({ ...current, productId: found.id }));
                      else unknownCode(value);
                    }}
                  />
                }
              />
              {movementProduct ? (
                <p className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
                  Físico: <b className="text-foreground">{qty(movementProduct.stockQuantity)} {movementProduct.unit}</b> · Reservado: {qty(movementProduct.reservedQuantity)} · Disponível: {qty(movementProduct.availableQuantity)}
                </p>
              ) : null}
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
                  aria-label={
                    movementForm.type === "adjustment"
                      ? "Quantidade (+/-)"
                      : "Quantidade"
                  }
                  type="number"
                  step="0.01"
                  min={movementForm.type === "adjustment" ? undefined : "0.01"}
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
            {movementAfter !== null && movementProduct ? (
              <p role="status" className={`rounded-lg p-2.5 text-xs ${movementAfter < 0 || movementAfter < movementProduct.reservedQuantity ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"}`}>
                Saldo depois: <b>{qty(movementAfter)} {movementProduct.unit}</b>
                {movementAfter < 0 ? ". Não dá para ficar negativo." : movementAfter < movementProduct.reservedQuantity && movementForm.quantity < 0 ? `. Ficaria abaixo dos ${qty(movementProduct.reservedQuantity)} reservados para orçamentos aprovados.` : ""}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Input
                aria-label="Responsável"
                readOnly
                disabled
                value={currentUserName}
              />
              <p className="text-xs text-muted-foreground">
                É sempre o usuário logado.
              </p>
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
            <AsyncButton
              pending={move.isPending}
              loadingLabel="Registrando…"
              disabled={!movementForm.productId || !movementForm.quantity}
              onClick={() =>
                move.mutate({
                  ...movementForm,
                  occurredAt: new Date(movementForm.occurredAt),
                })
              }
            >
              Registrar
            </AsyncButton>
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
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar retirada</DialogTitle>
            <DialogDescription>
              {selectedLine
                ? `Orçamento #${selectedLine.quoteNumber} · ${selectedLine.clientName || "Cliente não informado"}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <FormError message={inventoryError} />
          {selectedLine ? (
            <div className="space-y-4 py-2">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="font-semibold">{selectedLine.shortDescription}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Falta entregar: {qty(selectedLine.pendingQuantity)} {selectedLine.unit}{" "}
                  · Pode retirar agora: {qty(selectedLine.deliverableQuantity)}{" "}
                  {selectedLine.unit}
                  {selectedLine.shortageQuantity > 0
                    ? ` · Aguardando compra: ${qty(selectedLine.shortageQuantity)} ${selectedLine.unit}`
                    : ""}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Quantidade entregue</Label>
                <Input
                  aria-label="Quantidade entregue"
                  type="number"
                  min="0.01"
                  max={selectedLine.deliverableQuantity}
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
                  max={nowInput()}
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
                {selectedLine.productId
                  ? "Esta operação consome a reserva, reduz o estoque físico e mantém o restante do item como pendente."
                  : "Item avulso: a retirada fica registrada, sem movimentar o estoque."}
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeliveryOpen(false)}>
              Cancelar
            </Button>
            <AsyncButton
              pending={deliver.isPending}
              loadingLabel="Confirmando…"
              disabled={
                !selectedLine ||
                !deliveryForm.quantity ||
                deliveryForm.quantity > selectedLine.deliverableQuantity
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
            </AsyncButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
