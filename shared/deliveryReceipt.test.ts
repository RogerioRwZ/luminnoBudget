import { describe, expect, it } from "vitest";
import { buildReceipt, buildReceiptDocument, type ReceiptLine } from "./deliveryReceipt";

const at = new Date("2026-11-04T15:00:00Z");
const delivery = (id: number, quantity: number, over: Partial<ReceiptLine["deliveries"][number]> = {}) => ({ id, deliveredQuantity: quantity, deliveredAt: at, responsible: "Carlos", notes: null, reversedAt: null, ...over });
const line = (over: Partial<ReceiptLine>): ReceiptLine => ({ quoteNumber: 7, clientName: "Mariana", phone: null, quoteItemId: 1, roomName: "SALA", shortDescription: "Lustre", unit: "UN", orderedQuantity: 5, deliveredQuantity: 2, cancelledQuantity: 0, pendingQuantity: 3, deliveries: [delivery(10, 2)], ...over });

describe("comprovante de retirada", () => {
  it("junta os itens da mesma retirada e lista o que falta", () => {
    const receipt = buildReceipt([line({}), line({ quoteItemId: 2, shortDescription: "Spot", orderedQuantity: 1, deliveredQuantity: 1, pendingQuantity: 0, deliveries: [delivery(11, 1)] })], 11)!;
    expect(receipt.receiptNumber).toBe(10);
    expect(receipt.items.map((item) => item.description)).toEqual(["Lustre", "Spot"]);
    expect(receipt.pending.map((item) => [item.description, item.pending])).toEqual([["Lustre", 3]]);
  });

  it("outra data ou outro responsável é outra retirada; estornada não entra", () => {
    const lines = [line({ deliveries: [delivery(10, 1), delivery(11, 1, { responsible: "Ana" }), delivery(12, 1, { deliveredAt: new Date("2026-10-01T10:00:00Z") }), delivery(13, 1, { reversedAt: at })] })];
    expect(buildReceipt(lines, 10)!.items).toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(buildReceipt(lines, 11)!.responsible).toBe("Ana");
    expect(buildReceipt(lines, 13)).toBeNull();
    expect(buildReceipt(lines, 999)).toBeNull();
  });

  it("documento não mostra referência nem valores e protege o texto", () => {
    const receipt = buildReceipt([line({ shortDescription: "<b>Lustre</b>", orderedQuantity: 2.5, deliveredQuantity: 1.5, pendingQuantity: 1, deliveries: [delivery(10, 1.5)] })], 10)!;
    const html = buildReceiptDocument({ receipt, issuedAt: at, issuedBy: "Ana", brand: { tradingName: "Luz e Cia" } });
    expect(html).toContain("Comprovante de retirada nº 10");
    expect(html).toContain("&lt;b&gt;Lustre");
    expect(html).toContain("1,5 UN");
    expect(html).toContain("Ainda a retirar");
    expect(html).not.toMatch(/R\$|Ref\./);
  });

  it("sem responsável, deixa espaço para escrever à mão", () => {
    const html = buildReceiptDocument({ receipt: buildReceipt([line({ deliveries: [delivery(10, 2, { responsible: null })] })], 10)!, issuedAt: at });
    expect(html).toContain('class="blank"');
    expect(html).not.toContain("Não informado</p></div></section>");
  });

  it("pedido concluído avisa que não falta nada", () => {
    const html = buildReceiptDocument({ receipt: buildReceipt([line({ deliveredQuantity: 5, pendingQuantity: 0, deliveries: [delivery(10, 5)] })], 10)!, issuedAt: at });
    expect(html).toContain("Nada a retirar");
    expect(html).not.toContain("Ainda a retirar");
  });
});
