import { describe, expect, it } from "vitest";
import { duplicateDraftRoom, moveDraftItem, moveDraftRoom, removeDraftRoom } from "./quoteDraft";

describe("operações de ambientes do orçamento", () => {
  const rooms = [
    { name: "SALA", items: [{ code: "1" }] },
    { name: "COZINHA", items: [{ code: "2" }] },
  ];

  it("reordena um ambiente e preserva os itens", () => {
    const result = moveDraftRoom(rooms, 0, 1);
    expect(result.map((room) => room.name)).toEqual(["COZINHA", "SALA"]);
    expect(result[1]?.items[0]?.code).toBe("1");
  });

  it("duplica um ambiente com cópia independente dos itens", () => {
    const result = duplicateDraftRoom(rooms, 0);
    expect(result.map((room) => room.name)).toEqual(["SALA", "SALA (CÓPIA)", "COZINHA"]);
    expect(result[0]?.items).not.toBe(result[1]?.items);
  });

  it("não permite remover o único ambiente restante", () => {
    expect(removeDraftRoom([rooms[0]!], 0)).toHaveLength(1);
    expect(removeDraftRoom(rooms, 0).map((room) => room.name)).toEqual(["COZINHA"]);
  });

  it("reordena produtos dentro do mesmo ambiente", () => {
    const result = moveDraftItem([{ code: "A" }, { code: "B" }, { code: "C" }], 2, 0);
    expect(result.map((item) => item.code)).toEqual(["C", "A", "B"]);
  });
});
