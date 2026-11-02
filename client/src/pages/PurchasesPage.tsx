import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { downloadCsv } from "@/lib/csvDownload";
import { trpc } from "@/lib/trpc";
import { plural } from "@shared/plural";
import { buildPurchaseOrderText, purchaseQuantity } from "@shared/purchases";
import {
  ClipboardCopy,
  Download,
  PackageCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

const quantity = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

export default function PurchasesPage() {
  const { data = [], isLoading, error, refetch } =
    trpc.inventory.purchases.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();
  const [includeOpen, setIncludeOpen] = useState(false);

  const suppliers = useMemo(
    () =>
      data
        .map(supplier => ({
          ...supplier,
          lines: supplier.lines
            .map(line => ({ ...line, quantity: purchaseQuantity(line, includeOpen) }))
            .filter(line => line.quantity > 0),
        }))
        .filter(supplier => supplier.lines.length),
    [data, includeOpen]
  );
  const waitingQuotes = new Set(
    data.flatMap(supplier =>
      supplier.lines.flatMap(line => line.waitingQuotes.map(entry => entry.quoteId))
    )
  ).size;
  const productCount = suppliers.reduce((sum, supplier) => sum + supplier.lines.length, 0);
  const supplierLabel = (name: string) => name || "Sem fornecedor cadastrado";

  const copyOrder = async (supplier: (typeof suppliers)[number]) => {
    const text = buildPurchaseOrderText({
      supplierName: supplier.supplierName,
      storeName: settings?.tradingName,
      date: new Date(),
      lines: supplier.lines,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Pedido copiado. Cole no WhatsApp ou no e-mail do fornecedor.");
    } catch {
      toast.error("Não foi possível copiar. Use o CSV.");
    }
  };
  const exportCsv = (supplier: (typeof suppliers)[number]) =>
    downloadCsv(`compras-${supplier.supplierName || "sem-fornecedor"}`.replace(/[^\w-]+/g, "-"), supplier.lines, [
      { header: "Código", value: line => line.code },
      { header: "Produto", value: line => line.shortDescription },
      { header: "Unidade", value: line => line.unit },
      { header: "Comprar", value: line => line.quantity },
      { header: "Para pedidos aprovados", value: line => line.shortageQuantity },
      { header: "Estoque livre", value: line => line.freeQuantity },
      { header: "Ponto de pedido", value: line => line.reorderPoint },
      { header: "Em negociação", value: line => line.openDemandQuantity },
      {
        header: "Orçamentos aguardando",
        value: line => line.waitingQuotes.map(entry => `#${entry.quoteNumber}`).join(", "),
      },
    ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Operação e expedição</p>
          <h2 className="page-title">Compras por fornecedor</h2>
          <p className="page-description">
            O que pedir para atender os orçamentos aprovados sem estoque e
            repor os produtos abaixo do ponto de pedido. Quando a mercadoria
            chegar, registre a entrada no Estoque: ela é reservada na hora para
            quem está esperando.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2">
          <Switch
            id="include-open"
            checked={includeOpen}
            onCheckedChange={setIncludeOpen}
          />
          <Label htmlFor="include-open" className="text-sm">
            Incluir orçamentos em negociação
          </Label>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { icon: Truck, label: "Fornecedores", value: suppliers.length },
          { icon: ShoppingCart, label: "Produtos a comprar", value: productCount },
          { icon: PackageCheck, label: "Orçamentos aguardando mercadoria", value: waitingQuotes },
        ].map(card => (
          <Card key={card.label} className="border-border/70 shadow-sm">
            <CardContent className="p-5">
              <card.icon className="h-5 w-5 text-primary" />
              <p className="mt-5 text-xs font-semibold text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-1 font-display text-2xl font-bold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Calculando compras…
        </p>
      ) : error ? (
        <div role="alert" className="space-y-3 py-10 text-center text-sm text-muted-foreground">
          <p>Não foi possível calcular as compras.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : suppliers.length ? (
        suppliers.map(supplier => (
          <Card key={supplier.supplierName} className="border-border/70 shadow-sm">
            <CardHeader className="flex flex-col gap-3 space-y-0 border-b border-border sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="font-display text-lg">
                  {supplierLabel(supplier.supplierName)}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {plural(supplier.lines.length, "produto", "produtos")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => copyOrder(supplier)}>
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Copiar pedido
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportCsv(supplier)}>
                  <Download className="mr-2 h-4 w-4" />
                  Baixar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {supplier.lines.map(line => (
                  <div
                    key={line.productId}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{line.shortDescription}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cód. {line.code} · estoque livre {quantity(line.freeQuantity)}{" "}
                        {line.unit}
                        {line.reorderPoint > 0
                          ? ` · ponto de pedido ${quantity(line.reorderPoint)}`
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        {line.shortageQuantity > 0 ? (
                          <Badge
                            variant="secondary"
                            className="bg-rose-500/10 text-rose-700 dark:text-rose-300"
                          >
                            Já vendido, sem estoque: {quantity(line.shortageQuantity)}
                          </Badge>
                        ) : null}
                        {line.reorderPoint > 0 && line.freeQuantity < line.reorderPoint ? (
                          <Badge variant="secondary">Abaixo do ponto de pedido</Badge>
                        ) : null}
                        {includeOpen && line.openDemandQuantity > 0 ? (
                          <Badge
                            variant="secondary"
                            className="bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          >
                            Em negociação: {quantity(line.openDemandQuantity)}
                          </Badge>
                        ) : null}
                      </div>
                      {line.waitingQuotes.length ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Aguardando:{" "}
                          {line.waitingQuotes.map((entry, index) => (
                            <span key={entry.quoteId}>
                              {index ? ", " : ""}
                              <Link
                                href={`/orcamentos/${entry.quoteId}`}
                                className="font-semibold text-foreground underline-offset-2 hover:underline"
                              >
                                #{entry.quoteNumber}
                              </Link>{" "}
                              {entry.clientName ? `${entry.clientName} ` : ""}(
                              {quantity(entry.quantity)})
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Comprar
                      </p>
                      <p className="font-display text-xl font-bold">
                        {quantity(line.quantity)}{" "}
                        <span className="text-sm text-muted-foreground">{line.unit}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="py-12 text-center">
            <PackageCheck className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-300" />
            <p className="mt-3 text-sm font-semibold">Nada para comprar agora.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Os aprovados têm estoque reservado e nenhum produto está abaixo
              do ponto de pedido.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
