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
    auth: { status: { useQuery: () => ({ data: { user: { role: "admin" } } }) } },
    settings: { get: { useQuery: () => ({ data: { defaultWarrantyMonths: 12 } }) } },
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

  it("abre o cadastro com o código lido em outra tela e exige a referência", () => {
    mocks.list.data = [{ id: 9, code: "9", reference: "LM-1", shortDescription: "Spot", fullDescription: null, imageUrl: null, imageKey: null, barcode: "111", unit: "UN", supplierName: null, unitPrice: "1", stockQuantity: "0", reorderPoint: "0", active: true, parentId: null, modelName: null, attributes: null }];
    window.history.replaceState(null, "", "/catalogo?novo=7890000000017");
    render(<ProductsPage />);
    expect((screen.getByLabelText(/Código de barras/) as HTMLInputElement).value).toBe("7890000000017");
    expect(window.location.search).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getAllByText("Informe a referência do produto.").length).toBeGreaterThan(0);
    // Referência já usada (sem diferenciar maiúsculas) também não salva.
    fireEvent.change(screen.getByLabelText(/Referência/), { target: { value: "lm-1" } });
    expect(screen.getByText('Já usada em "Spot".')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Referência/), { target: { value: "LM-2/PT" } });
    fireEvent.change(screen.getByLabelText("Descrição curta (vai para o orçamento)"), { target: { value: "Spot novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ reference: "LM-2/PT", barcode: "7890000000017" }));
  });

  it("o cadastro não tem mais variações, e o próximo produto novo abre em branco", () => {
    mocks.list.data = [];
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    expect(screen.queryByRole("switch", { name: /tem variações/ })).toBeNull();
    expect(screen.queryByLabelText("Cor / acabamento")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Referência/), { target: { value: "LM-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    expect((screen.getByLabelText(/Referência/) as HTMLInputElement).value).toBe("");
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

  it("lista cada produto com a sua referência, sem agrupar, e busca por ela", () => {
    const base = { fullDescription: null, imageUrl: null, imageKey: null, unit: "UN", supplierName: "Lumi", unitPrice: "64.50", reorderPoint: "0", active: true, stockQuantity: "4" };
    mocks.list.data = [
      { ...base, id: 1, code: "1", reference: "GU10-PT", shortDescription: "Spot GU10 — Preto", barcode: null },
      { ...base, id: 2, code: "2", reference: "GU10-BR", shortDescription: "Spot GU10 — Branco", barcode: "789" },
    ];
    render(<ProductsPage />);
    expect(screen.getByText("Spot GU10 — Preto")).toBeTruthy();
    expect(screen.getByText("Spot GU10 — Branco")).toBeTruthy();
    expect(screen.queryByText(/variaç/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar por referência, descrição ou código de barras"), { target: { value: "gu10-br" } });
    expect(screen.queryByText("Spot GU10 — Preto")).toBeNull();
    expect(screen.getByText("Spot GU10 — Branco")).toBeTruthy();
  });
});
