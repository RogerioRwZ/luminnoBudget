export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));

export const compactNumber = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value ?? 0));

export const dateTime = (value: Date | string | null | undefined) =>
  value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

export const dateOnly = (value: Date | string | null | undefined) =>
  value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value)) : "—";

export const formatDateInput = (value: Date | string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 10);
};
