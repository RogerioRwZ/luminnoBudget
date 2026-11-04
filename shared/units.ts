// Unidade é a medida de venda (UN, M, CX). Número nesse campo foi digitado por
// engano, em geral pensando no estoque, e sairia ao lado da quantidade no PDF.
export const isNumericUnit = (value: string | null | undefined) => /^[\d\s.,]+$/.test((value ?? "").trim());

export function cleanUnit(value: string | null | undefined) {
  const unit = (value ?? "").trim();
  return !unit || isNumericUnit(unit) ? "UN" : unit;
}

export const NUMERIC_UNIT_MESSAGE = "A unidade é a medida do produto (UN, M, CX). O estoque é lançado em Estoque > Movimentar estoque.";
