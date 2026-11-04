// Unidade é a medida de venda (UN, M, CX). Número nesse campo foi digitado por
// engano, em geral pensando no estoque, e sairia ao lado da quantidade no PDF.
export const isNumericUnit = (value: string | null | undefined) => /^[\d\s.,]+$/.test((value ?? "").trim());

export function cleanUnit(value: string | null | undefined) {
  const unit = (value ?? "").trim();
  return !unit || isNumericUnit(unit) ? "UN" : unit;
}

export const NUMERIC_UNIT_MESSAGE = "A unidade é a medida do produto (UN, M, CX). O estoque é lançado em Estoque > Movimentar estoque.";

// Unidades mais usadas na loja, para escolher em vez de digitar. Outra medida
// continua aceita pelo campo "Outra".
export const UNIT_OPTIONS = [
  { value: "UN", label: "UN (unidade)" },
  { value: "PC", label: "PC (peça)" },
  { value: "M", label: "M (metro)" },
  { value: "M2", label: "M2 (metro quadrado)" },
  { value: "CX", label: "CX (caixa)" },
  { value: "RL", label: "RL (rolo)" },
  { value: "KIT", label: "KIT" },
  { value: "PAR", label: "PAR" },
  { value: "CJ", label: "CJ (conjunto)" },
  { value: "KG", label: "KG (quilo)" },
  { value: "L", label: "L (litro)" },
] as const;
export const isListedUnit = (value: string) => UNIT_OPTIONS.some((option) => option.value === value);
