import { describe, expect, it } from "vitest";
import { describeFulfillment, isCentQuantity } from "./stock";

describe("describeFulfillment", () => {
  it("permite retirar o que está reservado para o próprio item, mesmo sem estoque livre", () => {
    expect(describeFulfillment({ ordered: 10, delivered: 0, reserved: 10, stock: 10 })).toEqual({ pending: 10, deliverable: 10, shortage: 0 });
  });
  it("aponta a falta quando a reserva não cobre o pendente", () => {
    expect(describeFulfillment({ ordered: 10, delivered: 4, reserved: 2, stock: 2 })).toEqual({ pending: 6, deliverable: 2, shortage: 4 });
  });
  it("itens avulsos podem ser retirados por inteiro", () => {
    expect(describeFulfillment({ ordered: 3, delivered: 1, reserved: 0, stock: null })).toEqual({ pending: 2, deliverable: 2, shortage: 0 });
  });
});

describe("isCentQuantity", () => {
  it("aceita até 2 casas decimais", () => {
    expect(isCentQuantity(2.5)).toBe(true);
    expect(isCentQuantity(0.01)).toBe(true);
    expect(isCentQuantity(0.005)).toBe(false);
  });
});
