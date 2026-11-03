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
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Member = { id: number; code: string; attributes: string | null };
type Taken = { id: number; reference: string | null; barcode: string | null };

// Acrescenta variações a um modelo que já existe; cada uma com a sua
// referência (obrigatória) e, se quiser, detalhes e código de barras.
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
  const existingCombos = useMemo(
    () => new Set(members.map(member => parseAttributes(member.attributes)).filter(attributes => variantLabel(attributes)).map(attributesKey)),
    [members]
  );
  const variants = useVariantRows({ taken, reserved: root?.reference ? [root.reference] : [], existingCombos });
  // Abre com uma linha em branco.
  useEffect(() => {
    if (open) {
      variants.reset();
      variants.addRow();
    }
  }, [open]);
  const create = trpc.product.createVariants.useMutation({
    onSuccess: result => {
      utils.product.list.invalidate();
      utils.inventory.invalidate();
      toast.success(`${plural(result.created.length, "variação criada", "variações criadas")}.`);
      onOpenChange(false);
    },
    onError: err => setError(getFormErrorMessage(err, "Não foi possível criar as variações.")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        setError("");
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novas variações de {modelName}</DialogTitle>
          <DialogDescription>
            Cada variação tem referência própria (obrigatória). Cor, temperatura,
            potência e código de barras são opcionais. Preço, fornecedor, foto e
            descrição vêm do modelo.
          </DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <VariantRowsFields state={variants} modelName={modelName} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <AsyncButton
            pending={create.isPending}
            loadingLabel="Criando…"
            disabled={!root || !variants.rows.length}
            onClick={() => {
              variants.markAttempted();
              if (!root || variants.invalid) return setError("Confira as variações marcadas: a referência é obrigatória e não pode repetir.");
              setError("");
              create.mutate({ productId: root.id, variants: variants.payload() });
            }}
          >
            {variants.rows.length ? `Criar ${plural(variants.rows.length, "variação", "variações")}` : "Criar variações"}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
