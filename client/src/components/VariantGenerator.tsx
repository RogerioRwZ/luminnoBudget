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
const empty = Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, ""])) as Record<VariantKey, string>;

// Cria várias variações de uma vez: cada lista separada por vírgula vira um
// eixo, e o sistema gera todas as combinações (cores × temperaturas × ...).
export function VariantGenerator({
  open,
  onOpenChange,
  root,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: { id: number; modelName: string | null; shortDescription: string; attributes: string | null } | null;
  members: Member[];
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
  const create = trpc.product.createVariants.useMutation({
    onSuccess: result => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      toast.success(
        `${plural(result.created.length, "variação criada", "variações criadas")}${result.skipped.length ? `; ${plural(result.skipped.length, "já existia", "já existiam")}` : ""}.`
      );
      setLists(empty);
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
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Criar variações de {modelName}</DialogTitle>
          <DialogDescription>
            Separe as opções por vírgula. Cada variação vira um produto com
            código, estoque e código de barras próprios, copiando preço,
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
            <ul className="max-h-48 divide-y divide-border overflow-y-auto text-xs">
              {combinations.map(combo => (
                <li key={attributesKey(combo)} className={`px-3 py-1.5 ${existing.has(attributesKey(combo)) ? "text-muted-foreground line-through" : ""}`}>
                  {composeVariantName(modelName, combo)}
                </li>
              ))}
            </ul>
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
            disabled={!root || !fresh.length || fresh.length > 100}
            onClick={() => root && create.mutate({ productId: root.id, combinations: fresh })}
          >
            {fresh.length ? `Criar ${plural(fresh.length, "variação", "variações")}` : "Criar variações"}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
