import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  Boxes,
  Hash,
  ImagePlus,
  PackagePlus,
  Search,
  Truck,
  X,
} from "lucide-react";
import { ChangeEvent, useMemo, useState } from "react";
import { toast } from "sonner";

type ProductForm = {
  id?: number;
  code: string;
  shortDescription: string;
  fullDescription: string;
  imageUrl: string;
  imageKey: string;
  unit: string;
  supplierName: string;
  unitPrice: number;
  reorderPoint: number;
  active: boolean;
};
const emptyProduct: ProductForm = {
  code: "",
  shortDescription: "",
  fullDescription: "",
  imageUrl: "",
  imageKey: "",
  unit: "UN",
  supplierName: "",
  unitPrice: 0,
  reorderPoint: 0,
  active: true,
};

export default function ProductsPage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading, error, refetch } = trpc.product.list.useQuery();
  const save = trpc.product.save.useMutation({
    onSuccess: () => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      toast.success("Produto salvo com sucesso");
      setOpen(false);
    },
    onError: error => toast.error(error.message),
  });
  const upload = trpc.product.uploadImage.useMutation({
    onSuccess: file => {
      setForm(current => ({
        ...current,
        imageUrl: file.url,
        imageKey: file.key,
      }));
      toast.success("Imagem enviada");
    },
    onError: error => toast.error(error.message),
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const filtered = useMemo(
    () =>
      data.filter(product =>
        `${product.code} ${product.shortDescription} ${product.supplierName ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(search.toLocaleLowerCase("pt-BR"))
      ),
    [data, search]
  );
  const edit = (product: (typeof data)[number]) => {
    setForm({
      id: product.id,
      code: product.code,
      shortDescription: product.shortDescription,
      fullDescription: product.fullDescription ?? "",
      imageUrl: product.imageUrl ?? "",
      imageKey: product.imageKey ?? "",
      unit: product.unit,
      supplierName: product.supplierName ?? "",
      unitPrice: Number(product.unitPrice),
      reorderPoint: Number(product.reorderPoint),
      active: product.active,
    });
    setOpen(true);
  };
  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024)
      return toast.error("A imagem deve ter até 5 MB");
    if (
      !(["image/jpeg", "image/png", "image/webp"] as string[]).includes(
        file.type
      )
    )
      return toast.error("Use uma imagem JPG, PNG ou WEBP");
    const reader = new FileReader();
    reader.onload = () =>
      upload.mutate({
        fileName: file.name,
        mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
        dataUrl: String(reader.result),
      });
    reader.readAsDataURL(file);
  };
  const handleOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setForm(emptyProduct);
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Base de produtos</p>
          <h2 className="page-title">Catálogo</h2>
          <p className="page-description">
            Códigos numéricos são gerados automaticamente a partir de 1.
            Cadastre fornecedor, preços e reposição.
          </p>
        </div>
        <Dialog open={open} onOpenChange={handleOpen}>
          <DialogTrigger asChild>
            <Button className="h-11 px-5">
              <PackagePlus className="mr-2 h-4 w-4" />
              Novo produto
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {form.id ? `Editar produto #${form.code}` : "Novo produto"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Informe os dados do produto para o catálogo.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Código automático</p>
                    <p className="text-xs text-muted-foreground">
                      {form.id
                        ? `Este produto usa o código #${form.code}.`
                        : "O próximo código será atribuído ao salvar."}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Unidade</Label>
                <Input
                  aria-label="Unidade"
                  value={form.unit}
                  onChange={e =>
                    setForm({ ...form, unit: e.target.value.toUpperCase() })
                  }
                  placeholder="UN"
                />
              </div>
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <Input
                  aria-label="Fornecedor"
                  value={form.supplierName}
                  onChange={e =>
                    setForm({ ...form, supplierName: e.target.value })
                  }
                  placeholder="Ex.: Distribuidora Luminare"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>
                  Descrição curta{" "}
                  <span className="text-muted-foreground">
                    (vai para o orçamento)
                  </span>
                </Label>
                <Input
                  aria-label="Descrição curta (vai para o orçamento)"
                  value={form.shortDescription}
                  onChange={e =>
                    setForm({ ...form, shortDescription: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>
                  Descrição completa{" "}
                  <span className="text-muted-foreground">
                    (vai para a separação)
                  </span>
                </Label>
                <Textarea
                  aria-label="Descrição completa (vai para a separação)"
                  value={form.fullDescription}
                  onChange={e =>
                    setForm({ ...form, fullDescription: e.target.value })
                  }
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Valor unitário</Label>
                <Input
                  aria-label="Valor unitário"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unitPrice}
                  onChange={e =>
                    setForm({ ...form, unitPrice: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Ponto de reposição</Label>
                <Input
                  aria-label="Ponto de reposição"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.reorderPoint}
                  onChange={e =>
                    setForm({ ...form, reorderPoint: Number(e.target.value) })
                  }
                />
              </div>
              <div className="flex items-end gap-3 pb-2">
                <Switch
                  aria-label="Produto ativo"
                  checked={form.active}
                  onCheckedChange={active => setForm({ ...form, active })}
                />
                <Label>Produto ativo</Label>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Foto do produto</Label>
                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-3 sm:flex-row sm:items-center">
                  {form.imageUrl ? (
                    <img
                      src={form.imageUrl}
                      className="h-16 w-16 rounded-lg border object-contain"
                    />
                  ) : (
                    <div className="grid h-16 w-16 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <ImagePlus className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Envie um arquivo local JPG, PNG ou WEBP de até 5 MB. A
                      imagem será armazenada no servidor da Luminno.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <label>
                          <ImagePlus className="mr-2 h-3.5 w-3.5" />
                          Enviar imagem
                          <input
                            className="sr-only"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleImage}
                          />
                        </label>
                      </Button>
                      {form.imageUrl ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setForm({ ...form, imageUrl: "", imageKey: "" })
                          }
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Remover
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={save.isPending || upload.isPending}
                onClick={() => save.mutate(form)}
              >
                Salvar produto
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="relative border-b border-border p-4">
            <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar por código, descrição ou fornecedor"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por código, descrição ou fornecedor"
              className="max-w-md pl-9"
            />
          </div>
          {isLoading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Carregando catálogo…
            </p>
          ) : error ? (
            <div
              role="alert"
              className="space-y-3 p-8 text-center text-sm text-muted-foreground"
            >
              <p>Não foi possível carregar o catálogo.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : filtered.length ? (
            <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
              {filtered.map(product => {
                const stock = Number(product.stockQuantity);
                const point = Number(product.reorderPoint);
                const low = point > 0 && stock <= point;
                return (
                  <div key={product.id} className="flex gap-3 p-4">
                    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <ImagePlus className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-bold">
                          {product.shortDescription}
                        </p>
                        <button
                          onClick={() => edit(product)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Editar
                        </button>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        #{product.code} · {product.unit}
                      </p>
                      {product.supplierName ? (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Truck className="h-3 w-3" />
                          {product.supplierName}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between">
                        <p className="font-display text-base font-bold">
                          {money(product.unitPrice)}
                        </p>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide ${product.active ? "text-emerald-600" : "text-muted-foreground"}`}
                        >
                          {product.active ? "Ativo" : "Arquivado"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-2 text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Boxes className="h-3.5 w-3.5" />
                          Estoque
                        </span>
                        <Badge
                          variant="secondary"
                          className={
                            low
                              ? "bg-red-500/10 text-red-700"
                              : "bg-emerald-500/10 text-emerald-700"
                          }
                        >
                          {stock} {product.unit}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center">
              <PackagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-bold">Seu catálogo está vazio.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
