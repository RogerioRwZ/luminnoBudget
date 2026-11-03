import { AsyncButton, FormError, getFormErrorMessage } from "@/components/FormFeedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { CameraBarcodeScanner, ScanButton } from "@/components/CameraBarcodeScanner";
import { barcodeProblem, foldText, normalizeBarcode, referenceProblem, REFERENCE_MAX, suggestVariantReference, uniqueReference } from "@shared/productCodes";
import { plural } from "@shared/plural";
import {
  attributesKey,
  composeVariantName,
  parseAttributes,
  splitList,
  VARIANT_FIELDS,
  variantCombinations,
  variantLabel,
  type VariantKey,
} from "@shared/variants";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Member = { id: number; code: string; attributes: string | null };
type Taken = { reference: string | null; barcode: string | null };
const empty = Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, ""])) as Record<VariantKey, string>;

// Cria várias variações de uma vez: cada lista separada por vírgula vira um
// eixo, e o sistema gera todas as combinações (cores × temperaturas × ...).
export function VariantGenerator({
  open,
  onOpenChange,
  root,
  members,
  taken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: { id: number; code: string; reference: string | null; modelName: string | null; shortDescription: string; attributes: string | null } | null;
  members: Member[];
  // Referências e códigos de barras de todo o catálogo, para não repetir.
  taken: Taken[];
}) {
  const utils = trpc.useUtils();
  const [lists, setLists] = useState(empty);
  const [error, setError] = useState("");
  const modelName = root ? root.modelName || root.shortDescription : "";
  const existing = useMemo(() => new Set(members.map(member => attributesKey(parseAttributes(member.attributes)))), [members]);
  const combinations = useMemo(
    () => variantCombinations(Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, splitList(lists[field.key])]))),
    [lists]
  );
  const fresh = combinations.filter(combo => !existing.has(attributesKey(combo)));
  // Referência e código de barras de cada variação nova. Sem digitar, vale a
  // referência sugerida ("REF-PRETO-3000K").
  const [typed, setTyped] = useState<Record<string, { reference?: string; barcode?: string }>>({});
  const rows = useMemo(() => {
    const used = taken.map(item => item.reference);
    return fresh.map(combo => {
      const key = attributesKey(combo);
      const own = typed[key] ?? {};
      const reference = own.reference ?? uniqueReference(suggestVariantReference(root?.reference ?? root?.code ?? "", VARIANT_FIELDS.map(field => combo[field.key])), used);
      used.push(reference);
      return { key, combo, reference, barcode: own.barcode ?? "" };
    });
  }, [fresh, typed, taken, root]);
  const rowProblems = useMemo(() => {
    const references = new Map<string, number>();
    const barcodes = new Map<string, number>();
    rows.forEach(row => {
      references.set(foldText(row.reference.trim()), (references.get(foldText(row.reference.trim())) ?? 0) + 1);
      if (row.barcode) barcodes.set(row.barcode, (barcodes.get(row.barcode) ?? 0) + 1);
    });
    const takenReferences = new Set(taken.map(item => foldText(item.reference ?? "")));
    const takenBarcodes = new Set(taken.map(item => item.barcode).filter(Boolean));
    return new Map(rows.map(row => {
      const reference = foldText(row.reference.trim());
      const problem =
        referenceProblem(row.reference) ??
        (typed[row.key]?.reference !== undefined && takenReferences.has(reference) ? "Referência já usada em outro produto." : null) ??
        ((references.get(reference) ?? 0) > 1 ? "Referência repetida nesta lista." : null) ??
        barcodeProblem(row.barcode) ??
        (row.barcode && takenBarcodes.has(row.barcode) ? "Código de barras já usado em outro produto." : null) ??
        (row.barcode && (barcodes.get(row.barcode) ?? 0) > 1 ? "Código de barras repetido nesta lista." : null);
      return [row.key, problem];
    }));
  }, [rows, taken, typed]);
  const hasProblem = Array.from(rowProblems.values()).some(Boolean);
  const setRow = (key: string, change: { reference?: string; barcode?: string }) =>
    setTyped(current => ({ ...current, [key]: { ...current[key], ...change } }));
  // Leitura em sequência: cada código lido vai para a próxima variação sem código.
  const fillNextBarcode = (value: string) => {
    const barcode = normalizeBarcode(value);
    if (rows.some(row => row.barcode === barcode)) return toast.message(`O código ${barcode} já foi lido.`);
    const next = rows.find(row => !row.barcode);
    if (!next) return toast.message("Todas as variações já têm código de barras.");
    setRow(next.key, { barcode });
    toast.success(`${variantLabel(next.combo)}: ${barcode}`);
  };
  const create = trpc.product.createVariants.useMutation({
    onSuccess: result => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      toast.success(
        `${plural(result.created.length, "variação criada", "variações criadas")}${result.skipped.length ? `; ${plural(result.skipped.length, "já existia", "já existiam")}` : ""}.`
      );
      setLists(empty);
      setTyped({});
      onOpenChange(false);
    },
    onError: err => setError(getFormErrorMessage(err, "Não foi possível criar as variações.")),
  });
  const rootHasVariant = Boolean(variantLabel(parseAttributes(root?.attributes)));

  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        setError("");
        if (!value) setTyped({});
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Criar variações de {modelName}</DialogTitle>
          <DialogDescription>
            Separe as opções por vírgula. Cada variação vira um produto com
            referência, estoque e código de barras próprios, copiando preço,
            fornecedor, foto e descrição do produto principal.
          </DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        {!rootHasVariant ? (
          <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
            O produto principal (#{members.find(member => member.id === root?.id)?.code}) ainda não
            tem cor, temperatura ou potência. Depois de criar as variações,
            edite-o e preencha a variação dele para diferenciá-lo das outras.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
          {VARIANT_FIELDS.map(field => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`variant-list-${field.key}`}>{field.label}</Label>
              <Input
                id={`variant-list-${field.key}`}
                value={lists[field.key]}
                placeholder={field.key === "colorTemperature" ? "2700K, 3000K, 4000K" : field.key === "power" ? "5W, 7W" : field.key === "color" ? "Preto, Branco" : field.placeholder}
                onChange={event => setLists({ ...lists, [field.key]: event.target.value })}
              />
            </div>
          ))}
        </div>
        {combinations.length ? (
          <div className="rounded-xl border border-border">
            <p className="border-b border-border px-3 py-2 text-xs font-semibold">
              {plural(fresh.length, "variação nova", "variações novas")}
              {combinations.length > fresh.length
                ? ` · ${plural(combinations.length - fresh.length, "já existe", "já existem")}`
                : ""}
            </p>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto text-xs">
              {combinations.filter(combo => existing.has(attributesKey(combo))).map(combo => (
                <li key={attributesKey(combo)} className="px-3 py-1.5 text-muted-foreground line-through">
                  {composeVariantName(modelName, combo)}
                </li>
              ))}
              {rows.map(row => {
                const problem = rowProblems.get(row.key);
                return (
                  <li key={row.key} className="space-y-1.5 px-3 py-2">
                    <p className="font-semibold">{composeVariantName(modelName, row.combo)}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input
                        className="h-8 text-xs"
                        aria-label={`Referência de ${variantLabel(row.combo)}`}
                        aria-invalid={Boolean(problem) || undefined}
                        maxLength={REFERENCE_MAX}
                        value={row.reference}
                        onChange={event => setRow(row.key, { reference: event.target.value })}
                        placeholder="Referência"
                      />
                      <div className="flex gap-1.5">
                        <Input
                          className="h-8 text-xs"
                          aria-label={`Código de barras de ${variantLabel(row.combo)}`}
                          value={row.barcode}
                          onChange={event => setRow(row.key, { barcode: normalizeBarcode(event.target.value) })}
                          placeholder="Código de barras (opcional)"
                        />
                        <ScanButton className="h-8 w-8 shrink-0" title={`Ler código de barras de ${variantLabel(row.combo)}`} onDetected={value => setRow(row.key, { barcode: normalizeBarcode(value) })} />
                      </div>
                    </div>
                    {problem ? <p className="text-destructive">{problem}</p> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {rows.length > 1 ? (
          <div className="rounded-xl border border-dashed border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Tem as caixas em mãos? Leia os códigos em sequência: cada um vai para a próxima variação sem código de barras, na ordem da lista.
            </p>
            <CameraBarcodeScanner continuous label="Ler códigos em sequência" onDetected={fillNextBarcode} />
          </div>
        ) : null}
        {fresh.length > 100 ? (
          <p className="text-xs text-destructive">Crie no máximo 100 variações por vez.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <AsyncButton
            pending={create.isPending}
            loadingLabel="Criando…"
            disabled={!root || !fresh.length || fresh.length > 100 || hasProblem}
            onClick={() => root && create.mutate({ productId: root.id, variants: rows.map(row => ({ attributes: row.combo, reference: row.reference.trim(), barcode: row.barcode || null })) })}
          >
            {fresh.length ? `Criar ${plural(fresh.length, "variação", "variações")}` : "Criar variações"}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
