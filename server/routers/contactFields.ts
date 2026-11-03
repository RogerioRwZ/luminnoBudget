import { z } from "zod";
import { documentProblem, emailProblem, normalizeDocument, normalizeEmail, normalizePhone, phoneProblem } from "../../shared/contact";

// CPF/CNPJ, telefone e e-mail chegam de qualquer jeito (tela, backup, outro
// sistema) e são gravados sempre no padrão. `strict` recusa número inválido:
// usado no cadastro de clientes e nos dados da loja. Nos demais (orçamento,
// agenda...), só formata, para não travar quem está digitando.
const checked = (problem: (value: string | null | undefined) => string | null, normalize: (value: string | null | undefined) => string | null, strict: boolean, max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      const message = strict ? problem(value) : null;
      if (message) ctx.addIssue({ code: "custom", message });
    })
    .transform((value) => (value === undefined ? undefined : normalize(value)));

// Tamanhos das colunas no banco.
export const documentField = (strict = false) => checked(documentProblem, normalizeDocument, strict, 32);
export const phoneField = (strict = false) => checked(phoneProblem, normalizePhone, strict, 40);
export const emailField = () => checked(emailProblem, normalizeEmail, true, 320);
