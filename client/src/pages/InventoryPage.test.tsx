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

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ inventory: { invalidate: mocks.invalidate }, product: { list: { invalidate: mocks.invalidate } } }),
    inventory: {
      overview: { useQuery: () => ({ ...mocks.overview, refetch: mocks.refetchOverview }) },
      fulfillments: { useQuery: () => ({ ...mocks.fulfillments, refetch: mocks.refetchFulfillments }) },
      move: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      deliver: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
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
    expect(screen.getByText("Carregando entregas…")).toBeTruthy();
    mocks.overview = { data: emptyOverview, isLoading: false, error: null };
    mocks.fulfillments = { data: [], isLoading: false, error: null };
    rerender(<InventoryPage />);
    expect(screen.getByText("Nenhum produto corresponde aos filtros.")).toBeTruthy();
    expect(screen.getByText("Não há itens pendentes de entrega.")).toBeTruthy();
  });

  it("informa falha de estoque e permite nova tentativa", () => {
    mocks.overview.error = new Error("indisponível");
    render(<InventoryPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar o saldo de estoque.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetchOverview).toHaveBeenCalledOnce();
  });

  it("usa o estoque disponível (não o físico total) ao sugerir e limitar a quantidade de entrega", () => {
    mocks.overview.data = emptyOverview;
    // Produto com 10un físicas, mas com 6un já reservadas por outro
    // orçamento aprovado: para este item, sobram apenas 4un disponíveis,
    // mesmo ele próprio tendo reservado (para si) até 6un.
    mocks.fulfillments.data = [
      {
        quoteId: 1,
        quoteNumber: 55,
        clientName: "Cliente Teste",
        phone: null,
        quoteItemId: 900,
        roomName: "SALA",
        productId: 10,
        code: "1",
        shortDescription: "Perfil de LED",
        unit: "UN",
        orderedQuantity: 6,
        deliveredQuantity: 0,
        pendingQuantity: 6,
        reservedQuantity: 6,
        stockQuantity: 10,
        availableQuantity: 4,
        deliveries: [],
      },
    ];
    render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));

    const quantityInput = screen.getByLabelText(
      "Quantidade entregue"
    ) as HTMLInputElement;
    // Pré-preenchido com o disponível (4), não com o físico total (10) nem
    // com o reservado deste item (6).
    expect(quantityInput.value).toBe("4");
    expect(quantityInput.max).toBe("4");
  });
});
