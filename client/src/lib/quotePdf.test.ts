import { describe, expect, it } from "vitest";
import { createQuotePdfDataUrl } from "./quotePdf";

describe("geração de PDF de orçamento", () => {
  it("produz um documento PDF com os dados comerciais do orçamento", () => {
    const dataUrl = createQuotePdfDataUrl({
      quoteNumber: 42,
      clientName: "Cliente de teste",
      professional: "Arquiteta",
      document: "12.345.678/0001-90",
      stateRegistration: "",
      phone: "(11) 99999-9999",
      address: "Rua das Luzes, 100",
      issueDate: new Date("2026-08-25T12:00:00.000Z"),
      validUntil: new Date("2026-09-01T12:00:00.000Z"),
      discountMode: "percentage",
      discountValue: 5,
      shipping: 20,
      pixDiscountMode: "percentage",
      pixDiscountValue: 3,
      installments: 6,
      notes: "Prazo conforme disponibilidade.",
      rooms: [{ name: "SALA", items: [{ code: "1", shortDescription: "Perfil de LED", unit: "UN", quantity: 2, unitPrice: 150 }] }],
      summary: { rooms: [300], productsSubtotal: 300, discountAmount: 15, shipping: 20, total: 305, pixDiscountAmount: 9.15, pixTotal: 295.85 },
      settings: { companyName: "Luminno Iluminação", tradingName: "Luminno", document: null, address: null, phone: null, pixKey: null, pixRecipient: null },
    });

    expect(dataUrl).toMatch(/^data:application\/pdf/);
    expect(dataUrl.length).toBeGreaterThan(500);
  });
});
