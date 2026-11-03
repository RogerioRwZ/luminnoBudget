import {
  AsyncButton,
  FormError,
  getFormErrorMessage,
} from "@/components/FormFeedback";
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
import { Spinner } from "@/components/ui/spinner";
import { DraftAutosaveStatus } from "@/components/DraftAutosaveStatus";
import { removeDraft, useDraftAutosave } from "@/hooks/useDraftAutosave";
import { usePermissions } from "@/hooks/usePermissions";
import { canSeeCost } from "@shared/permissions";
import { percentLabel } from "@shared/margin";
import { money } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  Boxes,
  Hash,
  ImagePlus,
  Layers,
  Palette,
  Plus,
  PackagePlus,
  Search,
  Truck,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { VariantGenerator } from "@/components/VariantGenerator";
import { useVariantRows, variantRowFromProduct, VariantRowsFields, type VariantRowForm } from "@/components/VariantRows";
import { ScanButton } from "@/components/CameraBarcodeScanner";
import { isSupportedImage, prepareImage, renameForType } from "@/lib/shrinkImage";
import { barcodeProblem, findProductByScan, matchesProductSearch, normalizeBarcode, referenceProblem, REFERENCE_MAX } from "@shared/productCodes";
import { plural } from "@shared/plural";
import {
  cleanAttributes,
  composeVariantName,
  parseAttributes,
  variantDisplayName,
  VARIANT_FIELDS,
  variantLabel,
  type VariantKey,
} from "@shared/variants";
import { toast } from "sonner";

type ProductForm = {
  id?: number;
  code: string;
  reference: string;
  shortDescription: string;
  fullDescription: string;
  imageUrl: string;
  imageKey: string;
  barcode: string;
  unit: string;
  supplierName: string;
  unitPrice: number;
  // Texto: vazio quer dizer "custo não informado", diferente de custo zero.
  costPrice: string;
  reorderPoint: number;
  // Texto: vazio usa a garantia padrão das Configurações.
  warrantyMonths: string;
  active: boolean;
  parentId: number | null;
  modelName: string;
  attributes: Record<VariantKey, string>;
};
const emptyAttributes = Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, ""])) as Record<VariantKey, string>;
const emptyProduct: ProductForm = {
  code: "",
  reference: "",
  shortDescription: "",
  fullDescription: "",
  imageUrl: "",
  imageKey: "",
  barcode: "",
  unit: "UN",
  supplierName: "",
  unitPrice: 0,
  costPrice: "",
  reorderPoint: 0,
  warrantyMonths: "",
  active: true,
  parentId: null,
  modelName: "",
  attributes: emptyAttributes,
};
type Product = {
  id: number;
  code: string;
  reference: string | null;
  shortDescription: string;
  fullDescription: string | null;
  imageUrl: string | null;
  imageKey: string | null;
  barcode: string | null;
  unit: string;
  supplierName: string | null;
  unitPrice: string | number;
  costPrice?: string | number | null;
  stockQuantity: string | number;
  reorderPoint: string | number;
  warrantyMonths?: number | null;
  active: boolean;
  parentId: number | null;
  modelName: string | null;
  attributes: string | null;
};
const toFormAttributes = (text: string | null) => ({ ...emptyAttributes, ...parseAttributes(text) });
const costText = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(Number(value)));
const marginOf = (price: string | number, cost: string | number | null | undefined) =>
  cost === null || cost === undefined || cost === "" || Number(price) <= 0 ? null : (Number(price) - Number(cost)) / Number(price);

function CostLine({ price, cost }: { price: string | number; cost: string | number | null | undefined }) {
  const margin = marginOf(price, cost);
  if (margin === null) return <span className="text-[11px] text-muted-foreground">sem custo</span>;
  return (
    <span className={`text-[11px] ${margin < 0 ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
      custo {money(cost)} · margem {percentLabel(margin)}
    </span>
  );
}

export default function ProductsPage() {
  const utils = trpc.useUtils();
  const { role } = usePermissions();
  const showCost = canSeeCost(role);
  const { data: settings } = trpc.settings.get.useQuery(undefined, { staleTime: 5 * 60_000 });
  const { data = [], isLoading, error, refetch } = trpc.product.list.useQuery();
  const save = trpc.product.save.useMutation({
    onSuccess: () => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      setFormError("");
      removeDraft(`product-${form.id ?? "new"}`);
      toast.success("Produto salvo com sucesso");
      setOpen(false);
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível salvar o produto. Confira os campos e tente novamente."
      );
      setFormError(message);
      toast.error(message);
    },
  });
  // Produto novo já com as variações: modelo e variações gravados juntos.
  const saveWithVariants = trpc.product.saveWithVariants.useMutation({
    onSuccess: result => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      setFormError("");
      removeDraft("product-new");
      toast.success(`Produto salvo com ${plural(result.created.length, "variação", "variações")}`);
      setOpen(false);
    },
    onError: error => {
      const message = getFormErrorMessage(error, "Não foi possível salvar o produto e as variações. Confira os campos e tente novamente.");
      setFormError(message);
      toast.error(message);
    },
  });
  // Editar um modelo: o modelo e todas as variações salvos juntos.
  const saveFamily = trpc.product.saveFamily.useMutation({
    onSuccess: result => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      setFormError("");
      removeDraft(`product-${form.id ?? "new"}`);
      toast.success(`Modelo salvo${result.created.length ? ` com ${plural(result.created.length, "variação nova", "variações novas")}` : ""}`);
      setOpen(false);
    },
    onError: error => {
      const message = getFormErrorMessage(error, "Não foi possível salvar o modelo e as variações. Confira os campos e tente novamente.");
      setFormError(message);
      toast.error(message);
    },
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
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível enviar a imagem. Verifique o formato e tente novamente."
      );
      setFormError(message);
      toast.error(message);
    },
  });
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  // Produto com variações: o produto é o modelo e cada variação da lista tem
  // referência própria (obrigatória) e código de barras (opcional). Vale para
  // o cadastro novo ("Este produto tem variações") e para editar um modelo.
  const [withVariants, setWithVariants] = useState(false);
  const variantList = useVariantRows({ taken: data, reserved: form.id && form.reference.trim() ? [form.reference] : [] });
  const resetVariantList = (rows: VariantRowForm[] = []) => {
    setWithVariants(rows.length > 0);
    variantList.reset(rows);
  };
  const productDraft = useDraftAutosave(`product-${form.id ?? "new"}`, form, {
    enabled: open,
  });
  // Modelos com variações aparecem agrupados; o resto, como antes.
  const { families, standalone } = useMemo(() => {
    const matches = (product: Product) => matchesProductSearch(product, search);
    const childrenOf = new Map<number, Product[]>();
    data.forEach(product => {
      if (product.parentId) childrenOf.set(product.parentId, [...(childrenOf.get(product.parentId) ?? []), product]);
    });
    const families: Array<{ root: Product; members: Product[] }> = [];
    const standalone: Product[] = [];
    data.forEach(product => {
      if (product.parentId) return;
      const children = childrenOf.get(product.id) ?? [];
      if (!children.length) {
        if (matches(product)) standalone.push(product);
        return;
      }
      const members = [product, ...children.sort((first, second) => first.shortDescription.localeCompare(second.shortDescription, "pt-BR", { numeric: true }))];
      const visible = members.some(matches) ? (matches(product) ? members : members.filter(matches)) : [];
      if (visible.length) families.push({ root: product, members: visible });
    });
    return { families, standalone };
  }, [data, search]);
  const filteredCount = families.length + standalone.length;
  const [generatorFor, setGeneratorFor] = useState<Product | null>(null);
  const familyMembers = (rootId: number) => data.filter(product => product.id === rootId || product.parentId === rootId);
  const hasChildren = form.id ? data.some(product => product.parentId === form.id) : false;
  const familyMode = Boolean(form.parentId) || hasChildren || Boolean(variantLabel(form.attributes));
  const previewName = form.parentId
    ? variantDisplayName(form.modelName || form.shortDescription, cleanAttributes(form.attributes), form.reference.trim())
    : composeVariantName(form.modelName || form.shortDescription, cleanAttributes(form.attributes));
  // Modelo sem cor/temperatura próprias: não é vendido, então não pede
  // referência nem código de barras (a referência dele é interna).
  const modelOnly = withVariants && !variantLabel(form.attributes);
  const newVariant = (root: Product) => {
    resetVariantList();
    setForm({
      ...emptyProduct,
      parentId: root.id,
      modelName: root.modelName || root.shortDescription,
      shortDescription: root.modelName || root.shortDescription,
      fullDescription: root.fullDescription ?? "",
      imageUrl: root.imageUrl ?? "",
      imageKey: root.imageKey ?? "",
      unit: root.unit,
      supplierName: root.supplierName ?? "",
      unitPrice: Number(root.unitPrice),
      costPrice: costText(root.costPrice),
      reorderPoint: Number(root.reorderPoint),
      warrantyMonths: root.warrantyMonths == null ? "" : String(root.warrantyMonths),
    });
    setOpen(true);
  };
  // Avisa antes de salvar: referência e código de barras não podem repetir.
  const others = data.filter(product => product.id !== form.id);
  const referenceTwin = form.reference.trim() ? others.find(product => product.reference && findProductByScan([product], form.reference)) : undefined;
  const barcodeTwin = form.barcode ? others.find(product => product.barcode === form.barcode) : undefined;
  const [triedSave, setTriedSave] = useState(false);
  const referenceError = referenceTwin
    ? `Já usada em "${referenceTwin.shortDescription}".`
    : triedSave || form.reference
      ? referenceProblem(form.reference)
      : null;
  const barcodeError = barcodeTwin ? `Já está em "${barcodeTwin.shortDescription}".` : barcodeProblem(form.barcode);
  const submit = () => {
    setTriedSave(true);
    if (!modelOnly && (referenceProblem(form.reference) || referenceTwin || barcodeError)) {
      const message = referenceError ?? referenceProblem(form.reference) ?? barcodeError ?? "";
      setFormError(message);
      return;
    }
    const costPrice = showCost ? (form.costPrice.trim() === "" ? null : Number(form.costPrice.replace(",", "."))) : undefined;
    const warrantyMonths = form.warrantyMonths.trim() === "" ? null : Number(form.warrantyMonths);
    if (withVariants) {
      variantList.markAttempted();
      if (!variantList.rows.length) return setFormError("Adicione ao menos uma variação.");
      if (variantList.invalid) return setFormError("Confira as variações marcadas: a referência é obrigatória e não pode repetir.");
      setFormError("");
      if (form.id) {
        saveFamily.mutate({
          model: { ...form, id: form.id, shortDescription: familyMode ? previewName : form.shortDescription, modelName: form.modelName || form.shortDescription, attributes: form.attributes, parentId: null, costPrice, warrantyMonths },
          variants: variantList.payload(),
        });
      } else {
        saveWithVariants.mutate({
          product: { ...form, reference: undefined, barcode: null, attributes: null, parentId: null, modelName: null, costPrice, warrantyMonths },
          variants: variantList.payload(),
        });
      }
      return;
    }
    save.mutate({
      ...form,
      shortDescription: familyMode ? previewName : form.shortDescription,
      modelName: familyMode ? form.modelName || form.shortDescription : null,
      attributes: form.attributes,
      parentId: form.parentId,
      // Quem não vê o custo não envia o campo, e o custo gravado é mantido.
      costPrice: showCost ? (form.costPrice.trim() === "" ? null : Number(form.costPrice.replace(",", "."))) : undefined,
      warrantyMonths: form.warrantyMonths.trim() === "" ? null : Number(form.warrantyMonths),
    });
  };
  const edit = (product: Product) => {
    // Modelo com variações: a lista já vem com cada variação para editar.
    resetVariantList(
      data
        .filter(member => member.parentId === product.id)
        .sort((first, second) => first.shortDescription.localeCompare(second.shortDescription, "pt-BR", { numeric: true }))
        .map(member => variantRowFromProduct(member, parseAttributes))
    );
    setForm({
      id: product.id,
      code: product.code,
      reference: product.reference ?? product.code,
      shortDescription: product.shortDescription,
      fullDescription: product.fullDescription ?? "",
      imageUrl: product.imageUrl ?? "",
      imageKey: product.imageKey ?? "",
      barcode: product.barcode ?? "",
      unit: product.unit,
      supplierName: product.supplierName ?? "",
      unitPrice: Number(product.unitPrice),
      costPrice: costText(product.costPrice),
      reorderPoint: Number(product.reorderPoint),
      warrantyMonths: product.warrantyMonths == null ? "" : String(product.warrantyMonths),
      active: product.active,
      parentId: product.parentId,
      modelName: product.modelName ?? "",
      attributes: toFormAttributes(product.attributes),
    });
    setOpen(true);
  };
  const handleImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isSupportedImage(file.type))
      return toast.error("Use uma imagem JPG, PNG ou WEBP");
    // A foto é reduzida no aparelho antes de enviar (até 1600 px).
    const image = await prepareImage(file);
    if (image.size > 5 * 1024 * 1024)
      return toast.error("A imagem deve ter até 5 MB");
    upload.mutate({
      fileName: renameForType(file.name, image.mimeType),
      mimeType: image.mimeType,
      dataUrl: image.dataUrl,
    });
  };
  // Código lido que não está no catálogo: abre o cadastro já com ele.
  const startWithBarcode = (value: string) => {
    setSearch("");
    setFormError("");
    setTriedSave(false);
    resetVariantList();
    setForm({ ...emptyProduct, barcode: normalizeBarcode(value) });
    setOpen(true);
    toast.message(`Código ${value} não cadastrado. Preencha o novo produto.`);
  };
  // Vindo do atalho "Cadastrar" de outra tela (/catalogo?novo=CODIGO).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("novo");
    if (!code) return;
    window.history.replaceState(null, "", window.location.pathname);
    startWithBarcode(code);
  }, []);
  const handleOpen = (value: boolean) => {
    setOpen(value);
    resetVariantList();
    setFormError("");
    setTriedSave(false);
    if (!value) setForm(emptyProduct);
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Base de produtos</p>
          <h2 className="page-title">Catálogo</h2>
          <p className="page-description">
            Cadastre os produtos com referência, fornecedor, preço e ponto de
            reposição. O código interno de cada produto é criado automaticamente.
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
              <DialogTitle className="flex items-center gap-3">
                {form.id ? `Editar produto #${form.code}` : form.parentId ? "Nova variação" : "Novo produto"}
                <DraftAutosaveStatus status={productDraft.status} />
              </DialogTitle>
              <DialogDescription className="sr-only">
                Informe os dados do produto para o catálogo.
              </DialogDescription>
            </DialogHeader>
            <FormError message={formError} />
            {productDraft.hasRecovery ? (
              <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-semibold">Rascunho local encontrado</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recupere os dados deste produto ou descarte o rascunho salvo
                  neste dispositivo.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={productDraft.discard}
                  >
                    Descartar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const restored = productDraft.restore();
                      // Rascunhos antigos não têm os campos de variação.
                      if (restored) setForm({ ...emptyProduct, ...restored, attributes: { ...emptyAttributes, ...restored.attributes } });
                    }}
                  >
                    Recuperar
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
              {modelOnly ? (
                <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground sm:col-span-2">
                  Este produto é o <b className="text-foreground">modelo</b>: a referência e o código de barras
                  ficam em cada variação, na lista abaixo.
                  {form.id ? ` Referência interna do modelo: ${form.reference} · código #${form.code}.` : ""}
                </p>
              ) : (
              <div className="space-y-2">
                <Label htmlFor="product-reference">
                  Referência <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="product-reference"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(referenceError) || undefined}
                  maxLength={REFERENCE_MAX}
                  autoCapitalize="characters"
                  value={form.reference}
                  onChange={e => setForm({ ...form, reference: e.target.value })}
                  placeholder="Ex.: LM-100/PT"
                />
                {referenceError ? (
                  <p className="text-xs text-destructive">{referenceError}</p>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    {form.id ? `Código interno #${form.code}` : "O código interno é criado ao salvar."}
                  </p>
                )}
              </div>
              )}
              {modelOnly ? null : (
              <div className="space-y-2">
                <Label htmlFor="product-barcode">
                  Código de barras <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="product-barcode"
                    aria-invalid={Boolean(barcodeError) || undefined}
                    value={form.barcode}
                    onChange={e => setForm({ ...form, barcode: normalizeBarcode(e.target.value) })}
                    placeholder="EAN, leitor USB ou câmera"
                  />
                  <ScanButton onDetected={value => setForm(current => ({ ...current, barcode: normalizeBarcode(value) }))} />
                </div>
                {barcodeError ? <p className="text-xs text-destructive">{barcodeError}</p> : null}
              </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="product-unit">Unidade</Label>
                <Input
                  id="product-unit"
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
              {familyMode ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="product-model-name">
                    Nome do modelo{" "}
                    <span className="text-muted-foreground">
                      (comum a todas as variações)
                    </span>
                  </Label>
                  <Input
                    id="product-model-name"
                    value={form.modelName || form.shortDescription}
                    readOnly={Boolean(form.parentId)}
                    onChange={e => setForm({ ...form, modelName: e.target.value })}
                  />
                  {form.parentId ? (
                    <p className="text-xs text-muted-foreground">
                      Para renomear o modelo, edite o produto principal.
                    </p>
                  ) : hasChildren ? (
                    <p className="text-xs text-muted-foreground">
                      Mudar o nome do modelo renomeia todas as variações.
                    </p>
                  ) : null}
                </div>
              ) : (
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
              )}
              {!form.id && !form.parentId ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 sm:col-span-2">
                  <div>
                    <Label htmlFor="product-has-variants" className="text-sm font-semibold">
                      Este produto tem variações
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Cor, temperatura, potência… Cada variação tem referência,
                      estoque e código de barras próprios.
                    </p>
                  </div>
                  <Switch
                    id="product-has-variants"
                    checked={withVariants}
                    onCheckedChange={checked => {
                      setWithVariants(checked);
                      // Começa com uma linha em branco para a primeira variação.
                      if (checked) {
                        setForm(current => ({ ...current, attributes: emptyAttributes, barcode: "" }));
                        if (!variantList.rows.length) variantList.addRow();
                      }
                    }}
                  />
                </div>
              ) : null}
              {withVariants ? (
                <div className="space-y-3 rounded-xl border border-border p-3 sm:col-span-2">
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">Variações</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Em cada variação só a <b className="text-foreground">referência</b> é obrigatória; cor,
                    temperatura, potência e código de barras são opcionais. No orçamento
                    entram as variações, cada uma com a sua referência. Preço, fornecedor
                    e foto das novas vêm do modelo.
                  </p>
                  <VariantRowsFields state={variantList} modelName={form.modelName || form.shortDescription || "Produto"} />
                </div>
              ) : null}
              {modelOnly ? null : (
              <div className="space-y-3 rounded-xl border border-border p-3 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold">
                    Variação {familyMode ? "" : "(opcional)"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {VARIANT_FIELDS.map(field => (
                    <div key={field.key} className="space-y-1.5">
                      <Label htmlFor={`product-variant-${field.key}`} className="text-xs">
                        {field.label}
                      </Label>
                      <Input
                        id={`product-variant-${field.key}`}
                        value={form.attributes[field.key]}
                        placeholder={field.placeholder}
                        onChange={e =>
                          setForm(current => {
                            const attributes = { ...current.attributes, [field.key]: e.target.value };
                            return {
                              ...current,
                              modelName: current.modelName || current.shortDescription,
                              attributes,
                            };
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                {familyMode ? (
                  <p className="text-xs text-muted-foreground">
                    Vai aparecer no orçamento como <b className="text-foreground">{previewName}</b>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Preencha só se este produto for, sozinho, uma variação (cor,
                    temperatura, potência). Para cadastrar várias, ligue
                    "Este produto tem variações".
                  </p>
                )}
              </div>
              )}
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
              {showCost ? (
                <div className="space-y-2">
                  <Label htmlFor="product-cost">Preço de custo</Label>
                  <Input
                    id="product-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Não informado"
                    value={form.costPrice}
                    onChange={e => setForm({ ...form, costPrice: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {marginOf(form.unitPrice, form.costPrice) === null
                      ? "Não aparece para o perfil Vendas."
                      : `Margem de ${percentLabel(marginOf(form.unitPrice, form.costPrice))} sobre o preço de venda.`}
                  </p>
                </div>
              ) : null}
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
              <div className="space-y-2">
                <Label htmlFor="product-warranty">Garantia (meses)</Label>
                <Input
                  id="product-warranty"
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  placeholder={`Padrão da loja (${settings?.defaultWarrantyMonths ?? 12})`}
                  value={form.warrantyMonths}
                  onChange={e => setForm({ ...form, warrantyMonths: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Contada da retirada. Usada no pós-venda.</p>
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
                      Envie uma foto JPG, PNG ou WEBP. Ela é reduzida no
                      aparelho antes de ir para o servidor da Luminno.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                        disabled={upload.isPending}
                        aria-busy={upload.isPending || undefined}
                      >
                        <label>
                          {upload.isPending ? (
                            <Spinner aria-hidden="true" />
                          ) : (
                            <ImagePlus className="mr-2 h-3.5 w-3.5" />
                          )}
                          {upload.isPending ? "Enviando…" : "Enviar imagem"}
                          <input
                            className="sr-only"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={upload.isPending}
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
              <AsyncButton
                pending={save.isPending || saveWithVariants.isPending || saveFamily.isPending || upload.isPending}
                loadingLabel={
                  upload.isPending ? "Aguardando imagem…" : "Salvando produto…"
                }
                onClick={submit}
              >
                {withVariants && variantList.rows.length ? `Salvar com ${plural(variantList.rows.length, "variação", "variações")}` : "Salvar produto"}
              </AsyncButton>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-border p-4">
          <div className="flex max-w-xl gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar por referência, descrição ou código de barras"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por referência, descrição ou código de barras"
                className="pl-9"
              />
            </div>
            <ScanButton title="Buscar pelo código de barras" onDetected={value => {
              setSearch(value);
              const found = findProductByScan(data, value);
              if (!found) startWithBarcode(value);
            }} />
          </div>
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
          ) : filteredCount ? (
            <div>
            {families.map(({ root, members }) => (
              <div key={root.id} className="border-b border-border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted">
                    {root.imageUrl ? (
                      <img src={root.imageUrl} className="h-full w-full object-contain" />
                    ) : (
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{root.modelName || root.shortDescription}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {plural(familyMembers(root.id).filter(member => member.id !== root.id || variantLabel(parseAttributes(member.attributes))).length, "variação", "variações")}
                      </span>
                      {root.supplierName ? (
                        <span className="flex items-center gap-1">
                          <Truck className="h-3 w-3" />
                          {root.supplierName}
                        </span>
                      ) : null}
                      <span>
                        Estoque total:{" "}
                        {familyMembers(root.id).reduce((sum, member) => sum + Number(member.stockQuantity), 0)}{" "}
                        {root.unit}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => newVariant(root)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Uma variação
                    </Button>
                    <Button size="sm" onClick={() => setGeneratorFor(root)}>
                      <Layers className="mr-1.5 h-3.5 w-3.5" />
                      Criar várias
                    </Button>
                  </div>
                </div>
                <div className="mt-3 overflow-hidden rounded-xl border border-border">
                  {members.map(member => {
                    const stock = Number(member.stockQuantity);
                    const point = Number(member.reorderPoint);
                    const label = variantLabel(parseAttributes(member.attributes));
                    return (
                      <div key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-xs last:border-0">
                        <span className="min-w-40 flex-1 font-semibold">
                          {label || (member.id === root.id ? <span className="text-muted-foreground">Modelo · no orçamento entram as variações</span> : `Ref. ${member.reference ?? member.code}`)}
                          {member.id === root.id ? <Badge variant="outline" className="ml-2 text-[10px]">principal</Badge> : null}
                        </span>
                        <span className="font-mono text-muted-foreground">Ref. {member.reference ?? member.code} · #{member.code}</span>
                        <span className="font-mono text-muted-foreground">{member.barcode ? `Cód. barras ${member.barcode}` : "sem código de barras"}</span>
                        <span className="font-semibold">{money(member.unitPrice)}</span>
                        {showCost ? <CostLine price={member.unitPrice} cost={member.costPrice} /> : null}
                        <Badge variant="secondary" className={point > 0 && stock <= point ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700"}>
                          {stock} {member.unit}
                        </Badge>
                        {!member.active ? <span className="text-[10px] font-bold uppercase text-muted-foreground">Arquivado</span> : null}
                        <button onClick={() => edit(member)} className="font-semibold text-primary hover:underline">
                          Editar
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {standalone.length ? (
            <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
              {standalone.map(product => {
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
                        Ref. {product.reference ?? product.code} · #{product.code} · {product.unit}
                      </p>
                      {product.barcode ? (
                        <p className="font-mono text-[11px] text-muted-foreground">Cód. barras {product.barcode}</p>
                      ) : null}
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
                      {showCost ? <CostLine price={product.unitPrice} cost={product.costPrice} /> : null}
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
                      <button
                        onClick={() => setGeneratorFor(product)}
                        className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary"
                      >
                        <Layers className="h-3 w-3" />
                        Criar variações (cor, temperatura, potência)
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            ) : null}
            </div>
          ) : (
            <div className="p-12 text-center">
              <PackagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-bold">
                {data.length ? `Nenhum produto encontrado para "${search}".` : "Seu catálogo está vazio."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <VariantGenerator
        open={generatorFor !== null}
        onOpenChange={value => !value && setGeneratorFor(null)}
        root={generatorFor}
        members={generatorFor ? familyMembers(generatorFor.id) : []}
        taken={data}
      />
    </div>
  );
}
