import { describe, expect, it } from "vitest";
import { attributesKey, cleanAttributes, composeVariantName, parseAttributes, splitList, variantCombinations, variantLabel } from "./variants";

describe("variações de produto", () => {
  it("padroniza temperatura e potência e monta o nome", () => {
    const attributes = cleanAttributes({ color: " Preto  fosco ", colorTemperature: "3000", power: "7", other: "" });
    expect(attributes).toEqual({ color: "Preto fosco", colorTemperature: "3000K", power: "7W" });
    expect(variantLabel(attributes)).toBe("Preto fosco · 3000K · 7W");
    expect(composeVariantName("Spot GU10", attributes)).toBe("Spot GU10 — Preto fosco · 3000K · 7W");
    expect(composeVariantName("Spot GU10", {})).toBe("Spot GU10");
  });

  it("gera todas as combinações das listas preenchidas", () => {
    const combos = variantCombinations({ color: splitList("Preto, Branco"), colorTemperature: splitList("2700;3000"), power: [] });
    expect(combos.map(variantLabel)).toEqual(["Preto · 2700K", "Preto · 3000K", "Branco · 2700K", "Branco · 3000K"]);
  });

  it("compara variações sem diferenciar maiúsculas e ignora JSON inválido", () => {
    expect(attributesKey({ color: "Preto" })).toBe(attributesKey(cleanAttributes({ color: "preto" })));
    expect(parseAttributes("{não é json")).toEqual({});
    expect(parseAttributes('{"power":"10w"}')).toEqual({ power: "10W" });
  });
});
