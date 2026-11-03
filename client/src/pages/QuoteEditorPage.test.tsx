// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  mutate: vi.fn(),
  invalidate: vi.fn(),
  saveMutate: vi.fn(),
  saveOnSuccess: null as ((quote: unknown) => void) | null,
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  products: [] as any[],
}));

vi.mock("sonner", () => ({
  toast: {
    warning: mocks.toastWarning,
    error: mocks.toastError,
    success: mocks.toastSuccess,
    info: vi.fn(),
  },
}));

vi.mock("@/lib/trpc", () => {
  const quote = {
    id: 3, quoteNumber: 18, clientId: null, clientName: "Clínica Aurora", professional: "Arquiteta", document: null, stateRegistration: null, phone: null, address: null,
    status: "open", issueDate: new Date("2026-08-25T12:00:00.000Z"), validUntil: null, discountMode: "percentage", discountValue: "0", shipping: "0", pixDiscountMode: "percentage", pixDiscountValue: "0", installments: 6, notes: null,
    rooms: [{ name: "SALA", items: [{ productId: null, code: "1", shortDescription: "Perfil LED", imageUrl: "/uploads/produto.png", unit: "UN", quantity: "2", unitPrice: "150" }] }],
  };
  const mutation = () => ({ isPending: false, mutate: mocks.mutate });
  return {
    trpc: {
      useUtils: () => ({ quote: { list: { invalidate: mocks.invalidate }, pdfHistory: { invalidate: mocks.invalidate }, pdfHistoryAll: { invalidate: mocks.invalidate } }, dashboard: { invalidate: mocks.invalidate } }),
      quote: {
        get: { useQuery: () => ({ data: quote, isLoading: false }) },
        pdfHistory: { useQuery: () => ({ data: [{ id: 7, fileName: "orcamento-0018.pdf", fileSize: 1200, createdAt: new Date("2026-08-25T12:00:00.000Z"), downloadUrl: "/api/quote-pdfs/7/download" }], isLoading: false, isError: false }) },
        create: { useMutation: mutation },
        savePdf: { useMutation: mutation },
        save: {
          useMutation: (options?: { onSuccess?: (quote: unknown) => void }) => {
            mocks.saveOnSuccess = options?.onSuccess ?? null;
            return { isPending: false, mutate: mocks.saveMutate };
          },
        },
        delete: { useMutation: mutation },
      },
      product: { list: { useQuery: () => ({ data: mocks.products }) }, availability: { useQuery: () => ({ data: [] }) } },
      customers: { list: { useQuery: () => ({ data: [] }) } },
      settings: { get: { useQuery: () => ({ data: undefined }) } },
      inventory: { picking: { useQuery: () => ({ isFetching: false, refetch: vi.fn() }) } },
      finance: { byQuote: { useQuery: () => ({ data: [], isLoading: false }) } },
      auth: { status: { useQuery: () => ({ data: { user: { role: "admin" } } }) } },
    },
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/orcamentos/3", mocks.setLocation],
  useRoute: (route: string) => route === "/orcamentos/:id" ? [true, { id: "3" }] : [false, null],
}));

import QuoteEditorPage from "./QuoteEditorPage";

describe("QuoteEditorPage", () => {
  afterEach(cleanup);

  it("integra o histórico real e a ação de download ao orçamento aberto", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<QuoteEditorPage />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));

    expect(screen.getByText("orcamento-0018.pdf")).toBeTruthy();
    expect(click).toHaveBeenCalledOnce();
  });

  it("avisa quando a foto do produto não pôde ser incluída no PDF gerado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    render(<QuoteEditorPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gerar e salvar PDF" }));
    });

    expect(mocks.toastWarning).toHaveBeenCalledOnce();
    expect(mocks.toastWarning.mock.calls[0]?.[0]).toContain(
      "não pôde ser incluída no PDF"
    );
    expect(mocks.mutate).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("mantém o foco ao digitar continuamente o nome de um ambiente", () => {
    render(<QuoteEditorPage />);
    const roomName = screen.getByDisplayValue("SALA");
    roomName.focus();

    fireEvent.change(roomName, { target: { value: "SALA DE ESTAR" } });

    expect(screen.getByDisplayValue("SALA DE ESTAR")).toBe(document.activeElement);
  });

  it("mantém o foco ao editar o código de um item do ambiente", () => {
    render(<QuoteEditorPage />);
    const itemCode = screen.getByDisplayValue("1");
    itemCode.focus();

    fireEvent.change(itemCode, { target: { value: "A-001" } });

    expect(screen.getByDisplayValue("A-001")).toBe(document.activeElement);
  });

  it("expõe nomes acessíveis nos campos críticos da proposta", () => {
    render(<QuoteEditorPage />);

    expect(screen.getByLabelText("Emissão")).toBeTruthy();
    expect(screen.getByLabelText("Nome do cliente")).toBeTruthy();
    expect(screen.getByLabelText("Nome do ambiente 1")).toBeTruthy();
    expect(screen.getByLabelText("Descrição do item 1")).toBeTruthy();
    expect(screen.getByLabelText("Valor do desconto PIX")).toBeTruthy();
  });

  it("mantém os rótulos corretos mesmo com múltiplos ambientes", () => {
    render(<QuoteEditorPage />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ambiente" }));

    expect(screen.getByLabelText("Nome do ambiente 1")).toBeTruthy();
    expect(screen.getByLabelText("Nome do ambiente 2")).toBeTruthy();
    expect(screen.getByLabelText("Frete")).toBeTruthy();
    expect(screen.getByLabelText("Valor do desconto PIX")).toBeTruthy();
  });

  it("impede o salvamento e mantém a pessoa no editor quando faltam dados obrigatórios", () => {
    render(<QuoteEditorPage />);
    fireEvent.change(screen.getByLabelText("Nome do cliente"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(mocks.saveMutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome do cliente")).toBeTruthy();
  });

  it("não reverte um ambiente recém-digitado quando o autosave confirma um valor anterior", () => {
    vi.useFakeTimers();
    try {
      render(<QuoteEditorPage />);
      const roomName = screen.getByDisplayValue("SALA");

      // Usuário renomeia o ambiente; o autosave dispara após o debounce com esse valor.
      fireEvent.change(roomName, { target: { value: "SALA A" } });
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(mocks.saveMutate).toHaveBeenCalledTimes(1);
      expect(mocks.saveMutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ rooms: [expect.objectContaining({ name: "SALA A" })] })
      );

      // Enquanto a requisição está em andamento, a pessoa continua digitando.
      fireEvent.change(screen.getByDisplayValue("SALA A"), {
        target: { value: "SALA AZUL" },
      });

      // A resposta do servidor chega atrasada, confirmando o valor antigo ("SALA A").
      const staleQuote = {
        id: 3, quoteNumber: 18, clientId: null, clientName: "Clínica Aurora", professional: "Arquiteta", document: null, stateRegistration: null, phone: null, address: null,
        status: "open", issueDate: new Date("2026-08-25T12:00:00.000Z"), validUntil: null, discountMode: "percentage", discountValue: "0", shipping: "0", pixDiscountMode: "percentage", pixDiscountValue: "0", installments: 6, notes: null,
        rooms: [{ name: "SALA A", items: [{ productId: null, code: "1", shortDescription: "Perfil LED", imageUrl: null, unit: "UN", quantity: "2", unitPrice: "150" }] }],
      };
      act(() => {
        mocks.saveOnSuccess?.(staleQuote);
      });

      // O texto digitado por último deve permanecer, sem reverter para o valor confirmado pelo servidor.
      expect(screen.getByDisplayValue("SALA AZUL")).toBeTruthy();
      expect(screen.queryByDisplayValue("SALA A")).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("mantém a busca de produtos junto do ambiente correto ao reordenar ambientes", () => {
    render(<QuoteEditorPage />);
    const searchInputs = () =>
      screen.getAllByPlaceholderText(
        "Buscar por referência, descrição ou código de barras"
      ) as HTMLInputElement[];

    // Cria um segundo ambiente, ficando: [0] SALA, [1] NOVO AMBIENTE.
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ambiente" }));
    expect(searchInputs()).toHaveLength(2);

    // Digita uma busca apenas no primeiro ambiente (SALA).
    fireEvent.change(searchInputs()[0]!, { target: { value: "led" } });
    expect(searchInputs()[0]!.value).toBe("led");
    expect(searchInputs()[1]!.value).toBe("");

    // Move SALA (posição 0) para baixo, trocando de lugar com NOVO AMBIENTE.
    fireEvent.click(screen.getAllByTitle("Descer ambiente")[0]!);
    expect(screen.getByDisplayValue("NOVO AMBIENTE")).toBeTruthy();

    // A busca "led" deve continuar associada ao ambiente SALA, agora na 2ª posição —
    // e não "grudada" na posição 0, que agora pertence a outro ambiente.
    const reordered = searchInputs();
    expect(reordered[0]!.value).toBe("");
    expect(reordered[1]!.value).toBe("led");
  });

  it("mostra as variações de um modelo na busca e adiciona a escolhida", () => {
    const base = { fullDescription: null, imageUrl: null, imageKey: null, unit: "UN", supplierName: null, reorderPoint: "0", active: true, modelName: "Spot GU10", barcode: null };
    mocks.products = [
      { ...base, id: 21, code: "21", shortDescription: "Spot GU10 — Preto · 3000K", unitPrice: "60", stockQuantity: "4", parentId: null, attributes: '{"color":"Preto","colorTemperature":"3000K"}' },
      { ...base, id: 22, code: "22", shortDescription: "Spot GU10 — Branco · 3000K", unitPrice: "65", stockQuantity: "0", parentId: 21, attributes: '{"color":"Branco","colorTemperature":"3000K"}' },
    ];
    render(<QuoteEditorPage />);
    fireEvent.change(screen.getByLabelText("Buscar produto no ambiente 1"), { target: { value: "spot" } });
    const family = screen.getByRole("button", { name: /Spot GU10.*2 variações/ });
    fireEvent.click(family);
    expect(family.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Branco · 3000K/ }));
    expect(screen.getByDisplayValue("Spot GU10 — Branco · 3000K")).toBeTruthy();
    mocks.products = [];
  });
});
