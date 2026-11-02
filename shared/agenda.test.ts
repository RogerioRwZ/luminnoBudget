import { describe, expect, it } from "vitest";
import { buildAppointmentMessage, weekRange } from "./agenda";

describe("weekRange", () => {
  it("vai de segunda a segunda", () => {
    const { from, to } = weekRange(new Date(2026, 10, 5, 15)); // quinta
    expect([from.getDate(), from.getDay()]).toEqual([2, 1]);
    expect(to.getDate()).toBe(9);
  });
  it("domingo pertence à semana que começou na segunda anterior", () => {
    expect(weekRange(new Date(2026, 10, 8)).from.getDate()).toBe(2);
  });
});

describe("buildAppointmentMessage", () => {
  it("confirma tipo, orçamento e endereço", () => {
    const text = buildAppointmentMessage({ brand: "Luminno", type: "installation", clientName: "Marina", scheduledAt: new Date(2026, 10, 5, 14, 30), address: "Rua A, 10", quoteNumber: 12 });
    expect(text).toContain("instalação do orçamento #12");
    expect(text).toContain("14:30");
    expect(text).toContain("Rua A, 10");
  });
});
