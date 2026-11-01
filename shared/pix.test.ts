import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16, normalizePixKey } from "./pix";

describe("PIX copia e cola", () => {
  it("reproduz o exemplo do manual do Banco Central", () => {
    const payload = buildPixPayload({ key: "123e4567-e12b-12d1-a456-426655440000", name: "Fulano de Tal", city: "BRASILIA" });
    expect(payload).toBe("00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D");
  });

  it("inclui valor, identificador e CRC válido", () => {
    const payload = buildPixPayload({ key: "loja@luminno.com.br", name: "Luminno Iluminação Ltda", city: "São Paulo", amount: 1234.5, txid: "ORC-12/P2" });
    expect(payload).toContain("54071234.50");
    expect(payload).toContain("5923Luminno Iluminacao Ltda");
    expect(payload).toContain("6009Sao Paulo");
    expect(payload).toContain("0507ORC12P2");
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it("normaliza chaves de telefone, CPF e CNPJ", () => {
    expect(normalizePixKey("(11) 98888-7777")).toBe("+5511988887777");
    expect(normalizePixKey("+55 11 98888-7777")).toBe("+5511988887777");
    expect(normalizePixKey("123.456.789-09")).toBe("12345678909");
    expect(normalizePixKey("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizePixKey("loja@luminno.com.br")).toBe("loja@luminno.com.br");
  });

  it("exige chave cadastrada", () => {
    expect(() => buildPixPayload({ key: " ", name: "Loja", city: "SP" })).toThrow("chave PIX");
  });
});
