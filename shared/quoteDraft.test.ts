import { describe, expect, it } from "vitest";
import {
  duplicateArrayItem,
  duplicateDraftRoom,
  moveArrayItem,
  moveDraftItem,
  moveDraftRoom,
  removeArrayItem,
  removeDraftRoom,
} from "./quoteDraft";

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

describe("utilitários genéricos de reindexação (usados também para manter estados auxiliares, como a busca de produtos por ambiente, sincronizados com a lista de ambientes)", () => {
  it("move um valor mantendo os demais alinhados por posição", () => {
    expect(moveArrayItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveArrayItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  });

  it("duplica um valor na posição seguinte ao original", () => {
    expect(duplicateArrayItem(["a", "b"], 0, "a-cópia")).toEqual(["a", "a-cópia", "b"]);
  });

  it("remove um valor deslocando os índices seguintes", () => {
    expect(removeArrayItem(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
});
