import { Input } from "@/components/ui/input";
import { useState, type ComponentProps } from "react";

const formatters = {
  money: new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  quantity: new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3, useGrouping: false }),
};

// Aceita "1.234,56", "1234,56" e "1234.56".
export function parseDecimalInput(text: string, fallback = 0) {
  const trimmed = text.trim().replace(/\s|R\$/g, "");
  if (!trimmed) return fallback;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Campo numérico no formato brasileiro (949,90). Enquanto a pessoa digita,
// o texto fica como está; ao sair do campo, o valor é reformatado.
export function MoneyInput({
  value,
  onValueChange,
  format = "money",
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (value: number) => void;
  format?: keyof typeof formatters;
}) {
  const [text, setText] = useState<string | null>(null);
  const formatter = formatters[format];
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={text ?? formatter.format(value)}
      onFocus={event => {
        setText(formatter.format(value));
        props.onFocus?.(event);
      }}
      onChange={event => {
        setText(event.target.value);
        onValueChange(parseDecimalInput(event.target.value));
      }}
      onBlur={event => {
        setText(null);
        props.onBlur?.(event);
      }}
    />
  );
}
