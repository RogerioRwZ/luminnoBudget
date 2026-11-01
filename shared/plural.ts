// "1 parcela", "3 parcelas" — evita os "parcela(s)" espalhados pelas telas.
export function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${Math.abs(count) === 1 ? singular : pluralForm}`;
}
