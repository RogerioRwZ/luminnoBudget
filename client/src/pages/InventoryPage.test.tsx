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
});
