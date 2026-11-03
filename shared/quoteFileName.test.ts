import { describe, expect, it } from "vitest";
import { quotePdfFileName } from "./quoteFileName";

describe("quotePdfFileName", () => {
  it("usa número, cliente e profissional", () => {
    expect(quotePdfFileName({ quoteNumber: 12, clientName: "Maria Silva", professional: "Arq. Paulo" })).toBe("Orçamento 0012 - Maria Silva - Arq. Paulo.pdf");
  });

  it("omite o profissional quando não informado", () => {
    expect(quotePdfFileName({ quoteNumber: 7, clientName: "Maria Silva", professional: "  " })).toBe("Orçamento 0007 - Maria Silva.pdf");
  });

  it("remove caracteres inválidos em nomes de arquivo", () => {
    expect(quotePdfFileName({ quoteNumber: 3, clientName: "Ana/Cia: \"Loja\"", professional: null })).toBe("Orçamento 0003 - Ana Cia Loja.pdf");
  });
});

import { isLocalImage, sanitizePdfSnapshot } from "./quoteFileName";

describe("dados do PDF do histórico", () => {
  it("mantém só imagens do próprio sistema", () => {
    expect(isLocalImage("/uploads/products/a.webp")).toBe(true);
    expect(isLocalImage("https://rastreador.example/pixel.gif")).toBe(false);
    expect(isLocalImage("/uploads/../segredo")).toBe(false);
    expect(isLocalImage("javascript:alert(1)")).toBe(false);
    const clean = sanitizePdfSnapshot({
      rooms: [{ name: "SALA", items: [{ shortDescription: "A", imageUrl: "/uploads/products/a.webp" }, { shortDescription: "B", imageUrl: "http://192.168.0.1/admin" }] }],
      settings: { companyName: "Loja", logoUrl: "https://fora.example/logo.png" },
    });
    expect(clean.rooms).toEqual([{ name: "SALA", items: [{ shortDescription: "A", imageUrl: "/uploads/products/a.webp" }, { shortDescription: "B", imageUrl: null }] }]);
    expect(clean.settings).toEqual({ companyName: "Loja", logoUrl: null });
  });
});
