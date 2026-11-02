import { roundMoney } from "./quote";

// O mesmo profissional aparece digitado de jeitos diferentes nos orçamentos
// ("Ana Souza", "ana  souza "): a comissão junta pelo nome normalizado.
export function professionalKey(name: string | null | undefined) {
  return (name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

// A comissão é paga sobre o que o cliente já pagou, sem o frete: de cada
// recebimento, só a parte proporcional à mercadoria entra na base.
export function commissionBase(received: number, quoteTotal: number, shipping: number) {
  if (quoteTotal <= 0 || received <= 0) return 0;
  return roundMoney(received * (Math.max(0, quoteTotal - shipping) / quoteTotal));
}

export function commissionAmount(base: number, percent: number) {
  return roundMoney((base * Math.max(0, percent)) / 100);
}
