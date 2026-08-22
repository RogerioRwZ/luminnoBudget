import { describe, expect, it } from "vitest";
import { buildExpirationReminder, buildWhatsAppProposal, normalizeWhatsAppPhone } from "./whatsapp";

describe("WhatsApp helpers", () => {
  it("organiza a mensagem de proposta com divisão por ambiente", () => {
    const text = buildWhatsAppProposal({ brand: "Luminno", quoteNumber: 42, clientName: "Ana", rooms: [{ name: "SALA", items: [{ quantity: 2, shortDescription: "SPOT LED", unitPrice: 35 }] }], installments: 4, notes: "Entrega em até 10 dias.", summary: { rooms: [70], productsSubtotal: 70, discountAmount: 0, shipping: 0, total: 70, pixDiscountAmount: 7, pixTotal: 63, installmentValue: 17.5 } });
    expect(text).toContain("🏠 *SALA*");
    expect(text).toContain("• 2x SPOT LED — R$ 70,00");
    expect(text).toContain("⚡ PIX: R$ 63,00");
  });

  it("gera lembrete de vencimento compatível com WhatsApp", () => {
    const text = buildExpirationReminder({ brand: "Luminno", quoteNumber: 77, clientName: "Marina", validUntil: "2026-08-21T12:00:00", daysRemaining: 0, total: 850 });
    expect(text).toContain("vence hoje");
    expect(text).toContain("#77");
    expect(normalizeWhatsAppPhone("(11) 99999-9999")).toBe("5511999999999");
  });
});
