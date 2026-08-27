// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setLocation: vi.fn(), mutate: vi.fn(), invalidate: vi.fn() }));

vi.mock("@/lib/trpc", () => {
  const quote = {
    id: 3, quoteNumber: 18, clientId: null, clientName: "Clínica Aurora", professional: "Arquiteta", document: null, stateRegistration: null, phone: null, address: null,
    status: "open", issueDate: new Date("2026-08-25T12:00:00.000Z"), validUntil: null, discountMode: "percentage", discountValue: "0", shipping: "0", pixDiscountMode: "percentage", pixDiscountValue: "0", installments: 6, notes: null,
    rooms: [{ name: "SALA", items: [{ productId: null, code: "1", shortDescription: "Perfil LED", imageUrl: null, unit: "UN", quantity: "2", unitPrice: "150" }] }],
  };
  const mutation = () => ({ isPending: false, mutate: mocks.mutate });
  return {
    trpc: {
      useUtils: () => ({ quote: { list: { invalidate: mocks.invalidate }, pdfHistory: { invalidate: mocks.invalidate }, pdfHistoryAll: { invalidate: mocks.invalidate } }, dashboard: { invalidate: mocks.invalidate } }),
      quote: { get: { useQuery: () => ({ data: quote, isLoading: false }) }, pdfHistory: { useQuery: () => ({ data: [{ id: 7, fileName: "orcamento-0018.pdf", fileSize: 1200, createdAt: new Date("2026-08-25T12:00:00.000Z"), downloadUrl: "/api/quote-pdfs/7/download" }], isLoading: false, isError: false }) }, create: { useMutation: mutation }, savePdf: { useMutation: mutation }, save: { useMutation: mutation }, delete: { useMutation: mutation } },
      product: { list: { useQuery: () => ({ data: [] }) } },
      customers: { list: { useQuery: () => ({ data: [] }) } },
      settings: { get: { useQuery: () => ({ data: undefined }) } },
      inventory: { picking: { useQuery: () => ({ isFetching: false, refetch: vi.fn() }) } },
      finance: { byQuote: { useQuery: () => ({ data: [], isLoading: false }) } },
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

    expect(screen.getByLabelText("Data de emissão")).toBeTruthy();
    expect(screen.getByLabelText("Nome do cliente")).toBeTruthy();
    expect(screen.getByLabelText("Nome do ambiente")).toBeTruthy();
    expect(screen.getByLabelText("Descrição do item 1")).toBeTruthy();
    expect(screen.getByLabelText("Valor do desconto PIX")).toBeTruthy();
  });

  it("impede o salvamento e mantém a pessoa no editor quando faltam dados obrigatórios", () => {
    render(<QuoteEditorPage />);
    fireEvent.change(screen.getByLabelText("Nome do cliente"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome do cliente")).toBeTruthy();
  });
});
