import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraBarcodeScanner, ScanButton } from "@/components/CameraBarcodeScanner";
import { barcodeProblem, foldText, normalizeBarcode, referenceProblem, REFERENCE_MAX, suggestVariantReference, uniqueReference } from "@shared/productCodes";
import { plural } from "@shared/plural";
import {
  attributesKey,
  cleanAttributes,
  splitList,
  VARIANT_FIELDS,
  variantCombinations,
  variantDisplayName,
  variantLabel,
  type VariantKey,
} from "@shared/variants";
import { Layers, Plus, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const MAX_VARIANTS_AT_ONCE = 100;
const emptyAttributes = () => Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, ""])) as Record<VariantKey, string>;
let nextKey = 0;
const newKey = () => `nova-${++nextKey}`;

// Uma variação na tela: `id` só nas já gravadas. Só a referência é
// obrigatória; detalhes e código de barras são opcionais.
export type VariantRowForm = { key: string; id?: number; attributes: Record<VariantKey, string>; reference: string; barcode: string };
type Taken = { id: number; reference: string | null; barcode: string | null };

export function variantRowFromProduct(product: { id: number; reference: string | null; code: string; barcode: string | null; attributes: string | null }, parse: (text: string | null) => Partial<Record<VariantKey, string>>): VariantRowForm {
  return { key: `produto-${product.id}`, id: product.id, attributes: { ...emptyAttributes(), ...parse(product.attributes) }, reference: product.reference ?? product.code, barcode: product.barcode ?? "" };
}

export function useVariantRows({
  taken,
  reserved = [],
  existingCombos,
}: {
  // Referências e códigos de barras de todo o catálogo, para não repetir.
  taken: Taken[];
  // Referências desta mesma tela (a do modelo).
  reserved?: string[];
  // Detalhes de variações do modelo que não estão na lista (para não repetir).
  existingCombos?: Set<string>;
}) {
  const [rows, setRows] = useState<VariantRowForm[]>([]);
  const [attempted, setAttempted] = useState(false);
  const editingIds = new Set(rows.map(row => row.id).filter(Boolean));
  const problems = useMemo(() => {
    const others = taken.filter(item => !editingIds.has(item.id));
    const takenReferences = new Set([...others.map(item => foldText(item.reference ?? "")), ...reserved.map(value => foldText(value.trim()))].filter(Boolean));
    const takenBarcodes = new Set(others.map(item => item.barcode).filter(Boolean));
    const count = (values: string[]) => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>());
    const references = count(rows.map(row => foldText(row.reference.trim())).filter(Boolean));
    const barcodes = count(rows.map(row => row.barcode).filter(Boolean));
    const combos = count(rows.map(row => cleanAttributes(row.attributes)).filter(attributes => variantLabel(attributes)).map(attributesKey));
    return new Map(rows.map(row => {
      const reference = foldText(row.reference.trim());
      const attributes = cleanAttributes(row.attributes);
      const combo = variantLabel(attributes) ? attributesKey(attributes) : null;
      const problem =
        (!row.reference.trim() ? (attempted ? "Informe a referência." : null) : referenceProblem(row.reference)) ??
        (reference && takenReferences.has(reference) ? "Referência já usada em outro produto." : null) ??
        (reference && (references.get(reference) ?? 0) > 1 ? "Referência repetida nesta lista." : null) ??
        barcodeProblem(row.barcode) ??
        (row.barcode && takenBarcodes.has(row.barcode) ? "Código de barras já usado em outro produto." : null) ??
        (row.barcode && (barcodes.get(row.barcode) ?? 0) > 1 ? "Código de barras repetido nesta lista." : null) ??
        (combo && ((combos.get(combo) ?? 0) > 1 || existingCombos?.has(combo)) ? `A variação ${variantLabel(attributes)} já existe.` : null);
      return [row.key, problem];
    }));
  }, [rows, taken, reserved, existingCombos, attempted]);
  const invalid = rows.some(row => !row.reference.trim()) || Array.from(problems.values()).some(Boolean) || rows.length > MAX_VARIANTS_AT_ONCE;
  const update = (key: string, change: Partial<Omit<VariantRowForm, "key" | "id">>) =>
    setRows(current => current.map(row => (row.key === key ? { ...row, ...change } : row)));
  return {
    rows,
    problems,
    invalid,
    update,
    setAttributes: (key: string, field: VariantKey, value: string) =>
      setRows(current => current.map(row => (row.key === key ? { ...row, attributes: { ...row.attributes, [field]: value } } : row))),
    addRow: () => setRows(current => [...current, { key: newKey(), attributes: emptyAttributes(), reference: "", barcode: "" }]),
    removeRow: (key: string) => setRows(current => current.filter(row => row.key !== key || row.id)),
    // Gera uma linha por combinação ainda não listada (cores × temperaturas...).
    addCombinations: (lists: Record<VariantKey, string>) => {
      const present = new Set([...rows.map(row => attributesKey(cleanAttributes(row.attributes))), ...Array.from(existingCombos ?? [])]);
      const combos = variantCombinations(Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, splitList(lists[field.key])])))
        .filter(combo => !present.has(attributesKey(combo)));
      setRows(current => [...current, ...combos.map(combo => ({ key: newKey(), attributes: { ...emptyAttributes(), ...combo }, reference: "", barcode: "" }))]);
      return combos.length;
    },
    // Atalho opcional: preenche só as referências vazias a partir de um prefixo.
    fillReferences: (prefix: string) => {
      const used = [...taken.map(item => item.reference), ...reserved, ...rows.map(row => row.reference)];
      let filled = 0;
      const next = rows.map((row, index) => {
        if (row.reference.trim()) return row;
        const attributes = cleanAttributes(row.attributes);
        const wanted = variantLabel(attributes) ? suggestVariantReference(prefix, VARIANT_FIELDS.map(field => attributes[field.key])) : `${prefix.trim()}-${index + 1}`;
        const reference = uniqueReference(wanted, used);
        used.push(reference);
        filled += 1;
        return { ...row, reference };
      });
      setRows(next);
      return filled;
    },
    reset: (initial: VariantRowForm[] = []) => {
      setRows(initial);
      setAttempted(false);
    },
    markAttempted: () => setAttempted(true),
    // Formato que o servidor recebe.
    payload: () => rows.map(row => ({ ...(row.id ? { id: row.id } : {}), attributes: cleanAttributes(row.attributes), reference: row.reference.trim(), barcode: row.barcode || null })),
  };
}

export type VariantRowsState = ReturnType<typeof useVariantRows>;

export function VariantRowsFields({ state, modelName, allowCombinations = true }: { state: VariantRowsState; modelName: string; allowCombinations?: boolean }) {
  const { rows, problems, update, setAttributes, addRow, removeRow, addCombinations, fillReferences } = state;
  const [lists, setLists] = useState(emptyAttributes);
  const [showCombos, setShowCombos] = useState(false);
  const [prefix, setPrefix] = useState("");
  // Leitura em sequência: cada código lido vai para a próxima variação sem código.
  const fillNextBarcode = (value: string) => {
    const barcode = normalizeBarcode(value);
    if (rows.some(row => row.barcode === barcode)) return toast.message(`O código ${barcode} já foi lido.`);
    const index = rows.findIndex(row => !row.barcode);
    if (index < 0) return toast.message("Todas as variações já têm código de barras.");
    update(rows[index]!.key, { barcode });
    toast.success(`Variação ${index + 1}: ${barcode}`);
  };
  return (
    <div className="space-y-3">
      {rows.length ? (
        <ol className="space-y-2">
          {rows.map((row, index) => {
            const number = index + 1;
            const problem = problems.get(row.key);
            const name = variantDisplayName(modelName || "Produto", cleanAttributes(row.attributes), row.reference.trim());
            return (
              <li key={row.key} className={`space-y-2 rounded-xl border p-3 ${problem ? "border-destructive/60" : "border-border"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold">
                    <span className="mr-1.5 text-muted-foreground">{number}.</span>
                    {name}
                  </p>
                  {row.id ? null : (
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Remover a variação ${number}`} onClick={() => removeRow(row.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`variant-${row.key}-reference`} className="text-[11px]">
                      Referência <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`variant-${row.key}-reference`}
                      className="h-8 text-xs"
                      aria-label={`Referência da variação ${number}`}
                      aria-required="true"
                      aria-invalid={Boolean(problem) || undefined}
                      maxLength={REFERENCE_MAX}
                      autoCapitalize="characters"
                      value={row.reference}
                      onChange={event => update(row.key, { reference: event.target.value })}
                      placeholder="Ex.: ARC-01/PT"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`variant-${row.key}-barcode`} className="text-[11px]">
                      Código de barras <span className="text-muted-foreground">(opcional)</span>
                    </Label>
                    <div className="flex gap-1.5">
                      <Input
                        id={`variant-${row.key}-barcode`}
                        className="h-8 text-xs"
                        aria-label={`Código de barras da variação ${number}`}
                        value={row.barcode}
                        onChange={event => update(row.key, { barcode: normalizeBarcode(event.target.value) })}
                        placeholder="EAN, leitor ou câmera"
                      />
                      <ScanButton className="h-8 w-8 shrink-0" title={`Ler código de barras da variação ${number}`} onDetected={value => update(row.key, { barcode: normalizeBarcode(value) })} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {VARIANT_FIELDS.map(field => (
                    <Input
                      key={field.key}
                      className="h-8 text-xs"
                      aria-label={`${field.label} da variação ${number}`}
                      value={row.attributes[field.key]}
                      onChange={event => setAttributes(row.key, field.key, event.target.value)}
                      placeholder={`${field.label} (opcional)`}
                    />
                  ))}
                </div>
                {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Nenhuma variação ainda. Adicione uma por vez ou gere as combinações.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Adicionar variação
        </Button>
        {allowCombinations ? (
          <Button type="button" size="sm" variant="ghost" aria-expanded={showCombos} onClick={() => setShowCombos(!showCombos)}>
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            Gerar combinações
          </Button>
        ) : null}
      </div>
      {showCombos ? (
        <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
          <p className="text-xs text-muted-foreground">
            Separe as opções por vírgula: cada combinação vira uma linha, com a referência em branco para você preencher.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {VARIANT_FIELDS.map(field => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`variant-list-${field.key}`} className="text-[11px]">{field.label}</Label>
                <Input
                  id={`variant-list-${field.key}`}
                  className="h-8 text-xs"
                  value={lists[field.key]}
                  placeholder={field.key === "colorTemperature" ? "2700K, 3000K, 4000K" : field.key === "power" ? "5W, 7W" : field.key === "color" ? "Preto, Branco" : field.placeholder}
                  onChange={event => setLists({ ...lists, [field.key]: event.target.value })}
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const added = addCombinations(lists);
              if (added) {
                setLists(emptyAttributes());
                setShowCombos(false);
                toast.success(`${plural(added, "variação adicionada", "variações adicionadas")}. Preencha a referência de cada uma.`);
              } else toast.message("Nenhuma combinação nova para adicionar.");
            }}
          >
            Adicionar combinações
          </Button>
        </div>
      ) : null}
      {rows.some(row => !row.reference.trim()) ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-muted/50 p-3">
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="variant-prefix" className="text-[11px]">
              Atalho: preencher as referências vazias a partir de
            </Label>
            <Input id="variant-prefix" className="h-8 text-xs" value={prefix} onChange={event => setPrefix(event.target.value)} placeholder="Ex.: ARC" />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!prefix.trim()}
            onClick={() => {
              const filled = fillReferences(prefix);
              toast.success(`${plural(filled, "referência preenchida", "referências preenchidas")}. Confira antes de salvar.`);
            }}
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Preencher vazias
          </Button>
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
      {rows.length > MAX_VARIANTS_AT_ONCE ? (
        <p className="text-xs text-destructive">Use no máximo {MAX_VARIANTS_AT_ONCE} variações por vez.</p>
      ) : null}
    </div>
  );
}
