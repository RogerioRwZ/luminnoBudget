import { describe, expect, it } from "vitest";
import { buildPickingPrintDocument, openPickingPrintDocument } from "./pickingPrint";

describe("buildPickingPrintDocument", () => {
  it("gera o documento de separação com quantidade, ambientes e descrição completa", () => {
    const html = buildPickingPrintDocument({ quote: { quoteNumber: 77, clientName: "Ana & Cia", professional: "Arquiteta" }, issuedAt: "21/08/2026 10:00", items: [{ key: "product-1", code: "10", shortDescription: "SPOT", fullDescription: "Spot LED 7W <quente>", unit: "UN", quantity: 7, rooms: ["SALA", "COZINHA"] }] });
    expect(html).toContain("Orçamento #77");
    expect(html).toContain("Ana &amp; Cia");
    expect(html).toContain("Spot LED 7W &lt;quente&gt;");
    expect(html).toContain("SALA, COZINHA");
    expect(html).toContain("7 UN");
  });

  it("abre uma janela e escreve o mesmo documento gerado pela ação de exportação", () => {
    const writes: string[] = []; let closed = false;
    const data = { quote: { quoteNumber: 8, clientName: "Cliente", professional: "Profissional" }, issuedAt: "21/08/2026", items: [{ key: "product-1", code: "1", shortDescription: "ITEM", fullDescription: "Descrição completa", unit: "UN", quantity: 3, rooms: ["SALA"] }] };
    const opened = openPickingPrintDocument(data, () => ({ document: { write: (html) => writes.push(html), close: () => { closed = true; } } }));
    expect(opened).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("Descrição completa");
    expect(writes[0]).toContain("3 UN");
    expect(closed).toBe(true);
    expect(openPickingPrintDocument(data, () => null)).toBe(false);
  });
});
