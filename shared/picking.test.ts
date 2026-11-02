import { describe, expect, it } from "vitest";
import { buildPickingList, distributePicked, totalsByUnit } from "./picking";

describe("buildPickingList", () => {
  it("consolida o mesmo produto em ambientes diferentes e preserva a descrição completa", () => {
    const list = buildPickingList([
      { productId: 1, code: "1", shortDescription: "SPOT LED", fullDescription: "Spot LED embutir 7W, luz quente", unit: "UN", quantity: 3, roomName: "SALA" },
      { productId: 1, code: "1", shortDescription: "SPOT LED", fullDescription: "Spot LED embutir 7W, luz quente", unit: "UN", quantity: 4, roomName: "COZINHA" },
      { productId: 2, code: "2", shortDescription: "PERFIL", fullDescription: null, unit: "M", quantity: 2, roomName: "SALA" },
    ]);
    expect(list).toEqual([
      expect.objectContaining({ key: "product-1", code: "1", shortDescription: "SPOT LED", fullDescription: "Spot LED embutir 7W, luz quente", unit: "UN", quantity: 7, rooms: ["SALA", "COZINHA"] }),
      expect.objectContaining({ key: "product-2", code: "2", shortDescription: "PERFIL", fullDescription: "PERFIL", unit: "M", quantity: 2, rooms: ["SALA"] }),
    ]);
  });

  it("separa só o que falta e soma o que já foi retirado", () => {
    const [item] = buildPickingList([
      { quoteItemId: 10, productId: 1, code: "1", shortDescription: "SPOT", unit: "UN", quantity: 2, orderedQuantity: 6, deliveredQuantity: 4, deliverableQuantity: 2, roomName: "SALA" },
      { quoteItemId: 11, productId: 1, code: "1", shortDescription: "SPOT", unit: "UN", quantity: 4, orderedQuantity: 4, deliveredQuantity: 0, deliverableQuantity: 1, roomName: "COZINHA" },
    ]);
    expect(item).toMatchObject({ quantity: 6, orderedQuantity: 10, deliveredQuantity: 4, deliverableQuantity: 3 });
    expect(distributePicked(item!, 3)).toEqual({ lines: [{ quoteItemId: 10, quantity: 2 }, { quoteItemId: 11, quantity: 1 }], leftover: 0 });
    expect(distributePicked(item!, 5).leftover).toBe(2);
  });
});

describe("totalsByUnit", () => {
  it("não mistura unidades diferentes", () => {
    expect(totalsByUnit([{ unit: "UN", quantity: 3 }, { unit: "M", quantity: 5.5 }, { unit: "UN", quantity: 9 }])).toBe("12 UN · 5,5 M");
  });
});
