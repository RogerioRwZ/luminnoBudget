import { AsyncButton, FormError, getFormErrorMessage } from "@/components/FormFeedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useVariantRows, VariantRowsFields } from "@/components/VariantRows";
import { plural } from "@shared/plural";
import { attributesKey, parseAttributes, variantLabel } from "@shared/variants";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Member = { id: number; code: string; attributes: string | null };
type Taken = { reference: string | null; barcode: string | null };

// Cria várias variações de uma vez num modelo que já existe.
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
  const [error, setError] = useState("");
  const modelName = root ? root.modelName || root.shortDescription : "";
  const existingKeys = useMemo(() => new Set(members.map(member => attributesKey(parseAttributes(member.attributes)))), [members]);
  const variants = useVariantRows({ baseReference: root?.reference ?? root?.code ?? "", existingKeys, taken });
  const create = trpc.product.createVariants.useMutation({
    onSuccess: result => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      toast.success(
        `${plural(result.created.length, "variação criada", "variações criadas")}${result.skipped.length ? `; ${plural(result.skipped.length, "já existia", "já existiam")}` : ""}.`
      );
      variants.reset();
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
        if (!value) variants.reset();
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
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            O produto principal (Ref. {root?.reference ?? root?.code}) fica como modelo: no orçamento
            entram só as variações, cada uma com a sua referência.
          </p>
        ) : null}
        <VariantRowsFields state={variants} modelName={modelName} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <AsyncButton
            pending={create.isPending}
            loadingLabel="Criando…"
            disabled={!root || !variants.rows.length || variants.hasProblem}
            onClick={() => root && create.mutate({ productId: root.id, variants: variants.payload() })}
          >
            {variants.rows.length ? `Criar ${plural(variants.rows.length, "variação", "variações")}` : "Criar variações"}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
