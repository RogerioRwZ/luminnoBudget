export const VARIANT_FIELDS = [
  { key: "color", label: "Cor / acabamento", placeholder: "Preto fosco" },
  { key: "colorTemperature", label: "Temperatura de cor", placeholder: "3000K" },
  { key: "power", label: "Potência", placeholder: "7W" },
  { key: "other", label: "Outro", placeholder: "Ângulo 36°" },
] as const;
export type VariantKey = (typeof VARIANT_FIELDS)[number]["key"];
export type VariantAttributes = Partial<Record<VariantKey, string>>;

// "3000" vira "3000K" e "7" vira "7W"; o resto fica como foi digitado.
function normalize(key: VariantKey, value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (key === "colorTemperature" && /^\d{4}$/.test(trimmed)) return `${trimmed}K`;
  if (key === "colorTemperature") return trimmed.replace(/(\d)\s*k$/i, "$1K");
  if (key === "power" && /^\d+([.,]\d+)?$/.test(trimmed)) return `${trimmed}W`;
  if (key === "power") return trimmed.replace(/(\d)\s*w$/i, "$1W");
  return trimmed;
}

export function cleanAttributes(input: VariantAttributes | null | undefined): VariantAttributes {
  const result: VariantAttributes = {};
  for (const { key } of VARIANT_FIELDS) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) result[key] = normalize(key, value).slice(0, 80);
  }
  return result;
}

export function parseAttributes(text: string | null | undefined): VariantAttributes {
  if (!text) return {};
  try {
    return cleanAttributes(JSON.parse(text));
  } catch {
    return {};
  }
}

export function variantLabel(attributes: VariantAttributes) {
  return VARIANT_FIELDS.map(({ key }) => attributes[key]).filter(Boolean).join(" · ");
}

export function composeVariantName(modelName: string, attributes: VariantAttributes) {
  const label = variantLabel(attributes);
  return label ? `${modelName.trim()} — ${label}` : modelName.trim();
}

// Chave para não repetir a mesma variação dentro do modelo.
export function attributesKey(attributes: VariantAttributes) {
  return VARIANT_FIELDS.map(({ key }) => (attributes[key] ?? "").toLocaleLowerCase("pt-BR")).join("|");
}

// Todas as combinações das listas preenchidas: cores × temperaturas × potências.
export function variantCombinations(lists: Partial<Record<VariantKey, string[]>>): VariantAttributes[] {
  let combos: VariantAttributes[] = [{}];
  for (const { key } of VARIANT_FIELDS) {
    const values = Array.from(new Set((lists[key] ?? []).map((value) => value.trim()).filter(Boolean)));
    if (!values.length) continue;
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value })));
  }
  return combos.map(cleanAttributes).filter((combo) => variantLabel(combo));
}

export function splitList(text: string) {
  return text.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean);
}

// Peso de cada atributo ao sugerir uma variação no lugar de outra: trocar a
// temperatura de cor ou a potência incomoda menos que trocar o acabamento.
const SUBSTITUTE_WEIGHTS: Record<VariantKey, number> = { color: 5, colorTemperature: 2, power: 2, other: 1 };

// Variações do mesmo modelo com estoque para atender a quantidade pedida, das
// mais parecidas com a pedida para as menos parecidas.
export function rankSubstitutes<T extends { attributes: string | null; available: number }>(target: VariantAttributes, candidates: T[], needed: number, limit = 3) {
  return candidates
    .filter((candidate) => candidate.available >= needed)
    .map((candidate) => {
      const attributes = parseAttributes(candidate.attributes);
      const score = VARIANT_FIELDS.reduce((sum, { key }) => sum + (target[key] && attributes[key] === target[key] ? SUBSTITUTE_WEIGHTS[key] : 0), 0);
      return { candidate, score };
    })
    .sort((first, second) => second.score - first.score || second.candidate.available - first.candidate.available)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
