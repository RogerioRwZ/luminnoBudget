// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  list: { data: undefined as any, isLoading: false, error: null as Error | null },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ product: { list: { invalidate: mocks.invalidate } }, inventory: { invalidate: mocks.invalidate } }),
    product: {
      list: { useQuery: () => ({ ...mocks.list, refetch: mocks.refetch }) },
      save: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      uploadImage: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
  },
}));

import ProductsPage from "./ProductsPage";

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetch.mockReset();
  mocks.list = { data: undefined, isLoading: false, error: null };
});

describe("ProductsPage", () => {
  it("nomeia os controles do cadastro de produto", () => {
    const { container } = render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    expect(screen.getByLabelText("Unidade")).toBeTruthy();
    expect(screen.getByLabelText("Descrição curta (vai para o orçamento)")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Produto ativo" })).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });

  it("informa carregamento e catálogo vazio", () => {
    mocks.list.isLoading = true;
    const { rerender } = render(<ProductsPage />);
    expect(screen.getByText("Carregando catálogo…")).toBeTruthy();
    mocks.list.isLoading = false;
    rerender(<ProductsPage />);
    expect(screen.getByText("Seu catálogo está vazio.")).toBeTruthy();
  });

  it("informa falha e permite nova tentativa", () => {
    mocks.list.error = new Error("indisponível");
    render(<ProductsPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar o catálogo.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
