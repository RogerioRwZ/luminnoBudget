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
      createVariants: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
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

  it("agrupa as variações sob o modelo e monta o nome ao preencher a variação", () => {
    const base = { fullDescription: null, imageUrl: null, imageKey: null, unit: "UN", supplierName: "Lumi", unitPrice: "64.50", reorderPoint: "0", active: true, modelName: "Spot GU10" };
    mocks.list.data = [
      { ...base, id: 1, code: "1", shortDescription: "Spot GU10 — Preto · 3000K", barcode: null, stockQuantity: "4", parentId: null, attributes: '{"color":"Preto","colorTemperature":"3000K"}' },
      { ...base, id: 2, code: "2", shortDescription: "Spot GU10 — Branco · 3000K", barcode: "789", stockQuantity: "6", parentId: 1, attributes: '{"color":"Branco","colorTemperature":"3000K"}' },
      { ...base, id: 3, code: "3", shortDescription: "Fita LED", modelName: null, barcode: null, stockQuantity: "1", parentId: null, attributes: null },
    ];
    render(<ProductsPage />);
    expect(screen.getByText("Spot GU10")).toBeTruthy();
    expect(screen.getByText("2 variações")).toBeTruthy();
    expect(screen.getByText(/Estoque total: 10/)).toBeTruthy();
    expect(screen.getByText("Branco · 3000K")).toBeTruthy();
    expect(screen.getByText("Fita LED")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Uma variação/ }));
    fireEvent.change(screen.getByLabelText("Cor / acabamento"), { target: { value: "Dourado" } });
    fireEvent.change(screen.getByLabelText("Temperatura de cor"), { target: { value: "2700" } });
    expect(screen.getByText("Spot GU10 — Dourado · 2700K")).toBeTruthy();
  });
});
