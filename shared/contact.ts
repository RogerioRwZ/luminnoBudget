// CPF, CNPJ, telefone e e-mail: formato padrão e conferência. Usado pela
// tela (máscara enquanto digita) e pelo servidor (grava sempre no padrão).

export const onlyDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

// ---------------------------------------------------------------- CPF/CNPJ

// Caracteres do documento: números e, no CNPJ alfanumérico (Receita, desde
// julho de 2026), letras nas 12 primeiras posições.
export function documentChars(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 14);
}

const hasLetters = (chars: string) => /[A-Z]/.test(chars);

// Máscara progressiva: até 11 números é CPF (123.456.789-00); passando disso,
// ou com letras, é CNPJ (12.345.678/0001-00).
export function formatDocument(value: string | null | undefined) {
  const chars = documentChars(value);
  if (!chars) return "";
  if (chars.length <= 11 && !hasLetters(chars)) {
    return chars.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  const parts = [chars.slice(0, 2), chars.slice(2, 5), chars.slice(5, 8), chars.slice(8, 12), chars.slice(12, 14)];
  return `${parts[0]}${parts[1] ? `.${parts[1]}` : ""}${parts[2] ? `.${parts[2]}` : ""}${parts[3] ? `/${parts[3]}` : ""}${parts[4] ? `-${parts[4]}` : ""}`;
}

function validCpf(digits: string) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    const sum = Array.from(digits.slice(0, length)).reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

// CNPJ numérico ou alfanumérico: cada caractere vale o código ASCII menos 48
// (números continuam valendo o próprio número; "A" vale 17).
function validCnpj(chars: string) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(chars) || /^(.)\1{13}$/.test(chars)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = Array.from(chars.slice(0, length)).reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * weights[index]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(chars[12]) && check(13) === Number(chars[13]);
}

export function documentProblem(value: string | null | undefined): string | null {
  const chars = documentChars(value);
  if (!chars) return null;
  if (chars.length === 11 && !hasLetters(chars)) return validCpf(chars) ? null : "CPF inválido: confira os números.";
  if (chars.length === 14) return validCnpj(chars) ? null : "CNPJ inválido: confira os números.";
  return "Informe o CPF (11 dígitos) ou o CNPJ (14).";
}

// Grava no padrão quando o documento está completo; senão, como foi digitado.
export function normalizeDocument(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const chars = documentChars(trimmed);
  return (chars.length === 11 && !hasLetters(chars)) || chars.length === 14 ? formatDocument(chars) : trimmed;
}

// ---------------------------------------------------------------- telefone

// Só os dígitos do telefone, sem o 55 do país e sem o 0 da operadora.
export function phoneDigits(value: string | null | undefined) {
  let digits = onlyDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  if ((digits.length === 11 || digits.length === 12) && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 11);
}

// (00) 91234-5678 (celular) ou (00) 3123-4567 (fixo), montado enquanto digita.
export function formatPhone(value: string | null | undefined) {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const local = digits.slice(2);
  const split = digits.length === 11 ? 5 : 4;
  return `(${digits.slice(0, 2)}) ${local.slice(0, split)}${local.length > split ? `-${local.slice(split)}` : ""}`;
}

export function phoneProblem(value: string | null | undefined): string | null {
  const digits = phoneDigits(value);
  if (!digits) return null;
  if (digits.length !== 10 && digits.length !== 11) return "Informe o telefone com DDD: 10 dígitos (fixo) ou 11 (celular).";
  if (digits[0] === "0") return "DDD inválido.";
  if (digits.length === 11 && digits[2] !== "9") return "Celular deve começar com 9 depois do DDD.";
  return null;
}

export function normalizePhone(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return phoneProblem(trimmed) ? trimmed : formatPhone(trimmed);
}

// ---------------------------------------------------------------- e-mail

export const normalizeEmail = (value: string | null | undefined) => (value ?? "").trim().toLowerCase() || null;

export function emailProblem(value: string | null | undefined): string | null {
  const email = (value ?? "").trim();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? null : "E-mail inválido: confira o endereço.";
}

// ---------------------------------------------------------------- busca

// Chave para comparar documentos e telefones gravados em formatos diferentes.
export const contactKey = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

// Busca de clientes: nome, profissional, e-mail, e CPF/CNPJ e telefone com ou
// sem pontuação ("11999990000" acha "(11) 99999-0000").
export function matchesClientSearch(client: { name: string; professional?: string | null; document?: string | null; phone?: string | null; email?: string | null }, query: string) {
  const text = query.trim().toLocaleLowerCase("pt-BR");
  if (!text) return true;
  if (`${client.name} ${client.professional ?? ""} ${client.email ?? ""}`.toLocaleLowerCase("pt-BR").includes(text)) return true;
  const key = contactKey(query);
  if (key.length < 3) return false;
  const digits = onlyDigits(query);
  return contactKey(client.document).includes(key) || (digits.length >= 3 && phoneDigits(client.phone).includes(digits));
}
