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

describe("separação parcial", () => {
  it("lista só o que falta, mostra o já entregue e não soma unidades diferentes", () => {
    const html = buildPickingPrintDocument({ quote: { quoteNumber: 9, clientName: "Cliente", professional: "" }, issuedAt: "01/11/2026", items: [
      { key: "product-1", code: "1", shortDescription: "SPOT", fullDescription: "SPOT", unit: "UN", quantity: 6, orderedQuantity: 10, deliveredQuantity: 4, rooms: ["SALA"] },
      { key: "product-2", code: "2", shortDescription: "PERFIL", fullDescription: "PERFIL", unit: "M", quantity: 2.5, orderedQuantity: 2.5, deliveredQuantity: 0, rooms: ["SALA"] },
      { key: "product-3", code: "3", shortDescription: "DRIVER", fullDescription: "DRIVER", unit: "UN", quantity: 0, orderedQuantity: 2, deliveredQuantity: 2, rooms: ["SALA"] },
    ] });
    expect(html).toContain("Separação parcial");
    expect(html).toContain("4 de 10");
    expect(html).not.toContain("DRIVER");
    expect(html).toContain("1 produto já entregue por completo não aparece");
    expect(html).toContain("6 UN · 2,5 M");
  });
});

describe("referência na separação", () => {
  it("mostra a referência atual do produto; sem ela, o código do item", () => {
    const item = { key: "p1", code: "12", shortDescription: "SPOT", fullDescription: "SPOT", unit: "UN", quantity: 1, rooms: ["SALA"] };
    const html = buildPickingPrintDocument({ quote: { quoteNumber: 1, clientName: "C", professional: "P" }, issuedAt: "01/11/2026", items: [{ ...item, reference: "LM-100/PT" }, { ...item, key: "p2", code: "13" }] });
    expect(html).toContain("Ref. LM-100/PT");
    expect(html).toContain("Ref. 13");
    expect(html).not.toContain("Ref. 12");
  });
});

describe("impressão sem script na janela nova", () => {
  it("não embute script (a política de segurança bloquearia) e pede a impressão daqui", () => {
    const data = { quote: { quoteNumber: 9, clientName: "C", professional: "P" }, issuedAt: "01/11/2026", items: [] };
    expect(buildPickingPrintDocument(data)).not.toMatch(/<script/i);
    let printed = false;
    openPickingPrintDocument(data, () => ({ document: { write: () => undefined, close: () => undefined }, focus: () => undefined, print: () => { printed = true; } }));
    expect(printed).toBe(true);
  });
});
