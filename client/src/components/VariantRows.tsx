import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraBarcodeScanner, ScanButton } from "@/components/CameraBarcodeScanner";
import { barcodeProblem, foldText, normalizeBarcode, referenceProblem, REFERENCE_MAX, suggestVariantReference, uniqueReference } from "@shared/productCodes";
import { plural } from "@shared/plural";
import {
  attributesKey,
  composeVariantName,
  splitList,
  VARIANT_FIELDS,
  variantCombinations,
  variantLabel,
  type VariantAttributes,
  type VariantKey,
} from "@shared/variants";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Taken = { reference: string | null; barcode: string | null };
const emptyLists = Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, ""])) as Record<VariantKey, string>;
export const MAX_VARIANTS_AT_ONCE = 100;

export type VariantRow = { key: string; combo: VariantAttributes; reference: string; barcode: string };

// Lista de variações a criar: cada lista separada por vírgula vira um eixo
// (cores × temperaturas × ...) e cada combinação ganha referência própria
// (sugerida "REF-PRETO-3000K") e código de barras opcional.
export function useVariantRows({
  baseReference,
  existingKeys = new Set<string>(),
  taken,
  reserved = [],
}: {
  baseReference: string;
  // Variações que o modelo já tem (não aparecem de novo).
  existingKeys?: Set<string>;
  // Referências e códigos de barras de todo o catálogo, para não repetir.
  taken: Taken[];
  // Referências em uso nesta mesma tela (ex.: a do modelo sendo cadastrado).
  reserved?: string[];
}) {
  const [lists, setLists] = useState(emptyLists);
  const [typed, setTyped] = useState<Record<string, { reference?: string; barcode?: string }>>({});
  const combinations = useMemo(
    () => variantCombinations(Object.fromEntries(VARIANT_FIELDS.map(field => [field.key, splitList(lists[field.key])]))),
    [lists]
  );
  const fresh = combinations.filter(combo => !existingKeys.has(attributesKey(combo)));
  const rows: VariantRow[] = useMemo(() => {
    const used = [...taken.map(item => item.reference), ...reserved];
    return fresh.map(combo => {
      const key = attributesKey(combo);
      const own = typed[key] ?? {};
      const reference = own.reference ?? uniqueReference(suggestVariantReference(baseReference, VARIANT_FIELDS.map(field => combo[field.key])), used);
      used.push(reference);
      return { key, combo, reference, barcode: own.barcode ?? "" };
    });
  }, [fresh, typed, taken, reserved, baseReference]);
  const problems = useMemo(() => {
    const references = new Map<string, number>();
    const barcodes = new Map<string, number>();
    rows.forEach(row => {
      const reference = foldText(row.reference.trim());
      references.set(reference, (references.get(reference) ?? 0) + 1);
      if (row.barcode) barcodes.set(row.barcode, (barcodes.get(row.barcode) ?? 0) + 1);
    });
    const takenReferences = new Set(taken.map(item => foldText(item.reference ?? "")));
    const reservedReferences = new Set(reserved.map(value => foldText(value.trim())));
    const takenBarcodes = new Set(taken.map(item => item.barcode).filter(Boolean));
    return new Map(rows.map(row => {
      const reference = foldText(row.reference.trim());
      const problem =
        referenceProblem(row.reference) ??
        (typed[row.key]?.reference !== undefined && takenReferences.has(reference) ? "Referência já usada em outro produto." : null) ??
        (reservedReferences.has(reference) ? "Use uma referência diferente da do modelo." : null) ??
        ((references.get(reference) ?? 0) > 1 ? "Referência repetida nesta lista." : null) ??
        barcodeProblem(row.barcode) ??
        (row.barcode && takenBarcodes.has(row.barcode) ? "Código de barras já usado em outro produto." : null) ??
        (row.barcode && (barcodes.get(row.barcode) ?? 0) > 1 ? "Código de barras repetido nesta lista." : null);
      return [row.key, problem];
    }));
  }, [rows, taken, typed, reserved]);
  const setRow = (key: string, change: { reference?: string; barcode?: string }) =>
    setTyped(current => ({ ...current, [key]: { ...current[key], ...change } }));
  return {
    lists,
    setLists,
    combinations,
    existingKeys,
    rows,
    problems,
    setRow,
    hasProblem: Array.from(problems.values()).some(Boolean) || rows.length > MAX_VARIANTS_AT_ONCE,
    reset: () => {
      setLists(emptyLists);
      setTyped({});
    },
    // Formato que o servidor recebe.
    payload: () => rows.map(row => ({ attributes: row.combo, reference: row.reference.trim(), barcode: row.barcode || null })),
  };
}

export type VariantRowsState = ReturnType<typeof useVariantRows>;

export function VariantRowsFields({ state, modelName }: { state: VariantRowsState; modelName: string }) {
  const { lists, setLists, combinations, existingKeys, rows, problems, setRow } = state;
  // Leitura em sequência: cada código lido vai para a próxima variação sem código.
  const fillNextBarcode = (value: string) => {
    const barcode = normalizeBarcode(value);
    if (rows.some(row => row.barcode === barcode)) return toast.message(`O código ${barcode} já foi lido.`);
    const next = rows.find(row => !row.barcode);
    if (!next) return toast.message("Todas as variações já têm código de barras.");
    setRow(next.key, { barcode });
    toast.success(`${variantLabel(next.combo)}: ${barcode}`);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            {plural(rows.length, "variação nova", "variações novas")}
            {combinations.length > rows.length ? ` · ${plural(combinations.length - rows.length, "já existe", "já existem")}` : ""}
          </p>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto text-xs">
            {combinations.filter(combo => existingKeys.has(attributesKey(combo))).map(combo => (
              <li key={attributesKey(combo)} className="px-3 py-1.5 text-muted-foreground line-through">
                {composeVariantName(modelName, combo)}
              </li>
            ))}
            {rows.map(row => {
              const problem = problems.get(row.key);
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
      {rows.length > MAX_VARIANTS_AT_ONCE ? (
        <p className="text-xs text-destructive">Crie no máximo {MAX_VARIANTS_AT_ONCE} variações por vez.</p>
      ) : null}
    </div>
  );
}
