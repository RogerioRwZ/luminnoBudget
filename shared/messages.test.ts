import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATES, daysPhrase, mailtoLink, renderMessage, whatsappLink } from "./messages";

describe("mensagens a partir de modelos", () => {
  it("preenche variáveis, ignorando maiúsculas e espaços", () => {
    expect(renderMessage("Olá, {{cliente}}! Orçamento #{{ NUMERO }}: {{valor}}", { cliente: "Marina", numero: 12, valor: "R$ 10,00" })).toBe("Olá, Marina! Orçamento #12: R$ 10,00");
  });

  it("omite linhas que dependem de variável sem valor", () => {
    const body = renderMessage(DEFAULT_MESSAGE_TEMPLATES.payment_due.body, { cliente: "Ana", parcela: "2/8", numero: 5, valor: "R$ 100,00", vencimento: "10/11/2026", pix: "" });
    expect(body).toContain("parcela 2/8");
    expect(body).not.toContain("PIX copia e cola");
  });

  it("mantém variáveis desconhecidas para revelar erros no modelo", () => {
    expect(renderMessage("Oi {{nome_errado}}", { cliente: "Ana" })).toBe("Oi {{nome_errado}}");
  });

  it("monta links de WhatsApp e e-mail codificados", () => {
    expect(whatsappLink("5511988887777", "Olá & bom dia")).toBe("https://wa.me/5511988887777?text=Ol%C3%A1%20%26%20bom%20dia");
    expect(mailtoLink("a@b.com", "Assunto", "Linha 1\nLinha 2")).toBe("mailto:a%40b.com?subject=Assunto&body=Linha%201%0ALinha%202");
    expect(daysPhrase(-2)).toBe("venceu há 2 dia(s)");
    expect(daysPhrase(0)).toBe("vence hoje");
  });
});
