import { describe, expect, it } from "vitest";
import { assertReservableQuantity, calculateAvailableStock, calculatePendingDelivery, calculateRemainingReservation, calculateStockAfter, getStockDelta } from "./stock";

describe("stock operations", () => {
  it("mantém saldo pendente após entregas parciais", () => {
    expect(calculatePendingDelivery(10, [7])).toEqual({ delivered: 7, pending: 3 });
    expect(calculatePendingDelivery(10, [4, 3, 3])).toEqual({ delivered: 10, pending: 0 });
  });

  it("calcula entradas, entregas, devoluções e ajustes sem permitir saldo negativo", () => {
    expect(getStockDelta("delivery", 7)).toBe(-7);
    expect(calculateStockAfter(10, "delivery", 7)).toBe(3);
    expect(calculateStockAfter(3, "return", 2)).toBe(5);
    expect(calculateStockAfter(5, "adjustment", -2)).toBe(3);
    expect(() => calculateStockAfter(3, "delivery", 4)).toThrow("Saldo insuficiente");
  });

  it("separa saldo físico, saldo reservado e disponibilidade de venda", () => {
    expect(calculateAvailableStock(10, 7)).toBe(3);
    expect(calculateRemainingReservation(10, 7)).toBe(3);
    expect(() => calculateRemainingReservation(3, 4)).toThrow("excede a quantidade reservada");
    expect(assertReservableQuantity(10, 4, 6)).toBe(6);
    expect(() => assertReservableQuantity(10, 4, 7)).toThrow("Estoque disponível insuficiente");
  });
});
