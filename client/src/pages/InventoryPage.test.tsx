// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetchOverview: vi.fn(),
  refetchFulfillments: vi.fn(),
  overview: { data: undefined as any, isLoading: false, error: null as Error | null },
  fulfillments: { data: undefined as any, isLoading: false, error: null as Error | null },
}));

const emptyOverview = { products: [], lowStock: [], movements: [], suppliers: [], stockValue: 0 };

vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { status: { useQuery: () => ({ data: { user: { role: "admin" } } }) } },
    useUtils: () => ({ inventory: { invalidate: mocks.invalidate }, product: { list: { invalidate: mocks.invalidate } } }),
    inventory: {
      overview: { useQuery: () => ({ ...mocks.overview, refetch: mocks.refetchOverview }) },
      fulfillments: { useQuery: () => ({ ...mocks.fulfillments, refetch: mocks.refetchFulfillments }) },
      move: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      deliver: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      deliverAll: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      cancelRemainder: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      undoCancellation: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      reverseDelivery: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
  },
}));

import InventoryPage from "./InventoryPage";

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetchOverview.mockReset();
  mocks.refetchFulfillments.mockReset();
  mocks.overview = { data: undefined, isLoading: false, error: null };
  mocks.fulfillments = { data: undefined, isLoading: false, error: null };
});

describe("InventoryPage", () => {
  it("nomeia os filtros de saldo em estoque", () => {
    mocks.overview.data = emptyOverview;
    const { container } = render(<InventoryPage />);
    expect(screen.getByRole("combobox", { name: "Filtrar produtos por fornecedor" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Filtrar produtos por situação" })).toBeTruthy();
    expect(screen.getByLabelText("Saldo físico até")).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });

  it("informa carregamento e estados vazios", () => {
    mocks.overview.isLoading = true;
    mocks.fulfillments.isLoading = true;
    const { rerender } = render(<InventoryPage />);
    expect(screen.getByText("Carregando estoque…")).toBeTruthy();
    expect(screen.getByText("Carregando retiradas…")).toBeTruthy();
    mocks.overview = { data: emptyOverview, isLoading: false, error: null };
    mocks.fulfillments = { data: [], isLoading: false, error: null };
    rerender(<InventoryPage />);
    expect(screen.getByText("Nenhum produto corresponde aos filtros.")).toBeTruthy();
    expect(screen.getByText("Não há itens pendentes de retirada.")).toBeTruthy();
  });

  it("informa falha de estoque e permite nova tentativa", () => {
    mocks.overview.error = new Error("indisponível");
    render(<InventoryPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar o saldo de estoque.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetchOverview).toHaveBeenCalledOnce();
  });

  it("deixa retirar o que está reservado para o próprio item, mesmo sem estoque livre", () => {
    mocks.overview.data = emptyOverview;
    // 10 un. físicas, todas reservadas para este item: o estoque livre é 0,
    // mas a reserva é dele, então as 10 podem ser retiradas.
    mocks.fulfillments.data = [
      {
        quoteId: 1, quoteNumber: 55, clientName: "Cliente Teste", phone: null, approved: true,
        quoteItemId: 900, roomName: "SALA", productId: 10, barcode: null, code: "1", shortDescription: "Perfil de LED", fullDescription: null, unit: "UN", supplierName: null,
        orderedQuantity: 10, deliveredQuantity: 0, pendingQuantity: 10, reservedQuantity: 10, deliverableQuantity: 10, shortageQuantity: 0,
        stockQuantity: 10, availableQuantity: 0, unitPrice: 10, cancelledQuantity: 0, deliveries: [], cancellations: [],
      },
    ];
    render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Registrar retirada" }));
    const quantityInput = screen.getByLabelText("Quantidade entregue") as HTMLInputElement;
    expect(quantityInput.value).toBe("10");
    expect(quantityInput.max).toBe("10");
  });

  it("agrupa por orçamento e mostra o que falta comprar", () => {
    mocks.overview.data = emptyOverview;
    mocks.fulfillments.data = [
      {
        quoteId: 2, quoteNumber: 70, clientName: "Marina", phone: null, approved: true,
        quoteItemId: 901, roomName: "SALA", productId: 11, barcode: null, code: "2", shortDescription: "Spot", fullDescription: null, unit: "UN", supplierName: "Fornecedor",
        orderedQuantity: 6, deliveredQuantity: 0, pendingQuantity: 6, reservedQuantity: 0, deliverableQuantity: 0, shortageQuantity: 6,
        stockQuantity: 0, availableQuantity: 0, unitPrice: 10, cancelledQuantity: 0, deliveries: [], cancellations: [],
      },
    ];
    render(<InventoryPage />);
    expect(screen.getByText("Orçamento #70 · Marina")).toBeTruthy();
    expect(screen.getByText(/Falta comprar: 6/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Retirar tudo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: /Conferir com leitor/ }).getAttribute("href")).toBe("/estoque/conferencia/2");
  });

});
