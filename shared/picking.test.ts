import { describe, expect, it } from "vitest";
import { buildPickingList } from "./picking";

describe("buildPickingList", () => {
  it("consolida o mesmo produto em ambientes diferentes e preserva a descrição completa", () => {
    const list = buildPickingList([
      { productId: 1, code: "1", shortDescription: "SPOT LED", fullDescription: "Spot LED embutir 7W, luz quente", unit: "UN", quantity: 3, roomName: "SALA" },
      { productId: 1, code: "1", shortDescription: "SPOT LED", fullDescription: "Spot LED embutir 7W, luz quente", unit: "UN", quantity: 4, roomName: "COZINHA" },
      { productId: 2, code: "2", shortDescription: "PERFIL", fullDescription: null, unit: "M", quantity: 2, roomName: "SALA" },
    ]);
    expect(list).toEqual([
      { key: "product-1", code: "1", shortDescription: "SPOT LED", fullDescription: "Spot LED embutir 7W, luz quente", unit: "UN", quantity: 7, rooms: ["SALA", "COZINHA"] },
      { key: "product-2", code: "2", shortDescription: "PERFIL", fullDescription: "PERFIL", unit: "M", quantity: 2, rooms: ["SALA"] },
    ]);
  });
});
