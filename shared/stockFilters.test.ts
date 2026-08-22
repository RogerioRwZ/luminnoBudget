import { describe, expect, it } from "vitest";
import { filterInventoryProducts } from "./stockFilters";

const products = [
  { supplierName: "Luminare", stockQuantity: 3, reservedQuantity: 2, lowStock: true },
  { supplierName: "Luminare", stockQuantity: 12, reservedQuantity: 0, lowStock: false },
  { supplierName: "Brilha", stockQuantity: 1, reservedQuantity: 0, lowStock: true },
];

describe("filterInventoryProducts", () => {
  it("filtra por fornecedor e por saldo físico máximo informado", () => {
    expect(filterInventoryProducts(products, { supplier: "Luminare", maximumStock: "5", availability: "all" })).toEqual([products[0]]);
    expect(filterInventoryProducts(products, { supplier: "all", maximumStock: "1", availability: "all" })).toEqual([products[2]]);
  });

  it("filtra itens com reserva ativa ou abaixo da reposição", () => {
    expect(filterInventoryProducts(products, { supplier: "all", maximumStock: "", availability: "reserved" })).toEqual([products[0]]);
    expect(filterInventoryProducts(products, { supplier: "all", maximumStock: "", availability: "low" })).toEqual([products[0], products[2]]);
  });
});
