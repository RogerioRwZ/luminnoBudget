import { describe, expect, it } from "vitest";
import { buildAfterSalesReport, isCaseOverdue, isUnderWarranty, warrantyUntil, type AfterSalesReportCase } from "./afterSales";

describe("garantia", () => {
  it("soma meses pelo calendário e para no fim de meses curtos", () => {
    expect(warrantyUntil(new Date(2026, 0, 31, 10), 1)).toEqual(new Date(2026, 1, 28, 10));
    expect(warrantyUntil(new Date(2026, 4, 15), 12)).toEqual(new Date(2027, 4, 15));
    expect(warrantyUntil(new Date(2026, 4, 15), 0)).toBeNull();
    expect(warrantyUntil(null, 12)).toBeNull();
  });

  it("vale até o último dia, inclusive", () => {
    const until = new Date(2026, 10, 3, 9);
    expect(isUnderWarranty(until, new Date(2026, 10, 3, 18))).toBe(true);
    expect(isUnderWarranty(until, new Date(2026, 10, 4, 8))).toBe(false);
    expect(isUnderWarranty(null)).toBe(false);
  });
});

describe("prazo", () => {
  const now = new Date(2026, 10, 3, 15);
  it("atrasa só depois do dia do prazo e só em andamento", () => {
    expect(isCaseOverdue({ status: "open", dueDate: new Date(2026, 10, 3, 9) }, now)).toBe(false);
    expect(isCaseOverdue({ status: "supplier", dueDate: new Date(2026, 10, 2, 23) }, now)).toBe(true);
    expect(isCaseOverdue({ status: "resolved", dueDate: new Date(2026, 9, 1) }, now)).toBe(false);
  });
});

describe("relatório de pós-venda", () => {
  const base = { supplierName: "Lumi", type: "exchange", reason: "defect", status: "resolved", openedAt: new Date(2026, 10, 1), resolvedAt: new Date(2026, 10, 3), dueDate: new Date(2026, 10, 8) } as const;
  const cases: AfterSalesReportCase[] = [
    { ...base, productId: 1, productDescription: "Spot", quantity: 2 },
    { ...base, productId: 1, productDescription: "Spot", quantity: 1, reason: "damaged", status: "open", resolvedAt: null, dueDate: new Date(2026, 10, 2) },
    { ...base, productId: 2, productDescription: "Fita", quantity: 1, supplierName: null, type: "return", resolvedAt: new Date(2026, 10, 2) },
    { ...base, productId: null, productDescription: "Instalação", quantity: 1, type: "warranty", status: "rejected" },
  ];
  const report = buildAfterSalesReport(cases, new Map([[1, 30], [2, 0]]), new Date(2026, 10, 5));

  it("ordena produtos por ocorrências e calcula a taxa sobre o vendido", () => {
    expect(report.byProduct[0]).toMatchObject({ productId: 1, cases: 2, quantity: 3, sold: 30, rate: 10 });
    expect(report.byProduct.find((row) => row.productId === 2)).toMatchObject({ sold: 0, rate: null });
    expect(report.byProduct.find((row) => row.productId === null)).toMatchObject({ description: "Instalação", rate: null });
  });

  it("totaliza situação, atraso e tempo médio de solução", () => {
    expect(report.totals).toEqual({ cases: 4, quantity: 5, active: 1, overdue: 1, resolved: 2, rejected: 1, averageResolutionDays: 1.5 });
  });

  it("agrupa por motivo, tipo e fornecedor", () => {
    expect(report.byReason).toEqual([{ key: "defect", cases: 3, quantity: 4 }, { key: "damaged", cases: 1, quantity: 1 }]);
    expect(report.byType[0]).toEqual({ key: "exchange", cases: 2, quantity: 3 });
    expect(report.bySupplier).toEqual([{ key: "Lumi", cases: 3, quantity: 4 }, { key: "Sem fornecedor", cases: 1, quantity: 1 }]);
  });
});
