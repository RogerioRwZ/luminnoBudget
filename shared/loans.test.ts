import { describe, expect, it } from "vitest";
import { loanItemPending, loanStatus, validateSettlement } from "./loans";

const item = { quantity: 5, returnedQuantity: 1, soldQuantity: 1, lostQuantity: 0 };

describe("empréstimos do mostruário", () => {
  it("calcula o que ainda está com a pessoa e o atraso", () => {
    expect(loanItemPending(item)).toBe(3);
    const now = new Date(2026, 10, 3, 15);
    expect(loanStatus([item], new Date(2026, 10, 3, 9), now)).toEqual({ pending: 3, open: true, overdue: false });
    expect(loanStatus([item], new Date(2026, 10, 2), now).overdue).toBe(true);
    expect(loanStatus([{ ...item, returnedQuantity: 4 }], new Date(2026, 9, 1), now)).toEqual({ pending: 0, open: false, overdue: false });
  });

  it("não deixa acertar mais do que está emprestado", () => {
    expect(validateSettlement(item, { returned: 2, sold: 1, lost: 0 })).toBeNull();
    expect(validateSettlement(item, { returned: 2, sold: 1, lost: 1 })).toMatch(/Só 3/);
    expect(validateSettlement(item, { returned: -1, sold: 0, lost: 0 })).toMatch(/positivas/);
  });
});
