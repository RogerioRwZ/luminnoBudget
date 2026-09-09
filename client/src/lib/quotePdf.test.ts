import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuotePdfDataUrl } from "./quotePdf";

// PNG 1x1 válido, usado como imagem de teste para logotipo/fotos de produto.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngArrayBuffer(): ArrayBuffer {
  const binary = atob(ONE_PIXEL_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function mockFetchOk() {
  return vi.fn(async () => ({
    ok: true,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => pngArrayBuffer(),
  })) as unknown as typeof fetch;
}

const baseInput = {
  quoteNumber: 42,
  clientName: "Cliente de teste",
  professional: "Arquiteta",
  document: "12.345.678/0001-90",
  stateRegistration: "",
  phone: "(11) 99999-9999",
  address: "Rua das Luzes, 100",
  issueDate: new Date("2026-08-25T12:00:00.000Z"),
  validUntil: new Date("2026-09-01T12:00:00.000Z"),
  discountMode: "percentage" as const,
  discountValue: 5,
  shipping: 20,
  pixDiscountMode: "percentage" as const,
  pixDiscountValue: 3,
  installments: 6,
  notes: "Prazo conforme disponibilidade.",
  summary: { rooms: [300], productsSubtotal: 300, discountAmount: 15, shipping: 20, total: 305, pixDiscountAmount: 9.15, pixTotal: 295.85 },
};

describe("geração de PDF de orçamento", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produz um documento PDF com os dados comerciais do orçamento", async () => {
    const { dataUrl, failedImageCount } = await createQuotePdfDataUrl({
      ...baseInput,
      rooms: [{ name: "SALA", items: [{ code: "1", shortDescription: "Perfil de LED", unit: "UN", quantity: 2, unitPrice: 150 }] }],
      settings: { companyName: "Luminno Iluminação", tradingName: "Luminno", document: null, address: null, phone: null, pixKey: null, pixRecipient: null },
    });

    expect(dataUrl).toMatch(/^data:application\/pdf/);
    expect(dataUrl.length).toBeGreaterThan(500);
    expect(failedImageCount).toBe(0);
  });

  it("incorpora o logotipo da empresa e as fotos dos produtos quando disponíveis", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const { dataUrl, failedImageCount } = await createQuotePdfDataUrl({
      ...baseInput,
      rooms: [{ name: "SALA", items: [{ code: "1", shortDescription: "Perfil de LED", imageUrl: "/uploads/produto.png", unit: "UN", quantity: 2, unitPrice: 150 }] }],
      settings: { companyName: "Luminno Iluminação", tradingName: "Luminno", logoUrl: "/uploads/logo.png", document: null, address: null, phone: null, pixKey: null, pixRecipient: null },
    });

    expect(dataUrl).toMatch(/^data:application\/pdf/);
    expect(failedImageCount).toBe(0);
    // Uma imagem por URL único (logo + foto do produto), buscada uma única vez cada.
    const requestedUrls = fetchMock.mock.calls.map(call => call[0]);
    expect(requestedUrls).toContain("/uploads/logo.png");
    expect(requestedUrls).toContain("/uploads/produto.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("não busca a mesma foto de produto mais de uma vez quando reutilizada em vários itens", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    await createQuotePdfDataUrl({
      ...baseInput,
      rooms: [
        {
          name: "SALA",
          items: [
            { code: "1", shortDescription: "Perfil de LED", imageUrl: "/uploads/produto.png", unit: "UN", quantity: 2, unitPrice: 150 },
            { code: "1", shortDescription: "Perfil de LED", imageUrl: "/uploads/produto.png", unit: "UN", quantity: 1, unitPrice: 150 },
          ],
        },
      ],
      summary: { rooms: [450], productsSubtotal: 450, discountAmount: 0, shipping: 0, total: 450, pixDiscountAmount: 0, pixTotal: 450 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gera o PDF normalmente mesmo quando a imagem falha ao carregar, e informa quantas falharam", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const { dataUrl, failedImageCount } = await createQuotePdfDataUrl({
      ...baseInput,
      rooms: [{ name: "SALA", items: [{ code: "1", shortDescription: "Perfil de LED", imageUrl: "/uploads/produto.png", unit: "UN", quantity: 2, unitPrice: 150 }] }],
      settings: { companyName: "Luminno Iluminação", tradingName: "Luminno", logoUrl: "/uploads/logo.png", document: null, address: null, phone: null, pixKey: null, pixRecipient: null },
    });

    expect(dataUrl).toMatch(/^data:application\/pdf/);
    // Logo + foto do produto: 2 URLs únicas, ambas falharam.
    expect(failedImageCount).toBe(2);
  });

  it("conta apenas as imagens que de fato falharam, não as que carregaram com sucesso", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/uploads/logo.png") throw new Error("network down");
      return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => pngArrayBuffer() };
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { failedImageCount } = await createQuotePdfDataUrl({
      ...baseInput,
      rooms: [{ name: "SALA", items: [{ code: "1", shortDescription: "Perfil de LED", imageUrl: "/uploads/produto.png", unit: "UN", quantity: 2, unitPrice: 150 }] }],
      settings: { companyName: "Luminno Iluminação", tradingName: "Luminno", logoUrl: "/uploads/logo.png", document: null, address: null, phone: null, pixKey: null, pixRecipient: null },
    });

    expect(failedImageCount).toBe(1);
  });
});
