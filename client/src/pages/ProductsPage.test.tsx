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
    useUtils: () => ({ product: { list: { invalidate: mocks.invalidate } }, inventory: { invalidate: mocks.invalidate }, suppliers: { invalidate: mocks.invalidate } }),
    suppliers: { list: { useQuery: () => ({ data: [{ id: 1, name: "Luminare", productCount: 2 }] }) }, rename: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) } },
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

  it("mostra a descrição completa e busca por ela", () => {
    const base = { imageUrl: null, imageKey: null, barcode: null, unit: "UN", supplierName: null, unitPrice: "10", costPrice: null, stockQuantity: "0", reorderPoint: "0", warrantyMonths: null, active: true };
    mocks.list.data = [
      { ...base, id: 1, code: "1", reference: "A-1", shortDescription: "Spot", fullDescription: "Corpo em alumínio\nideal para gesso" },
      { ...base, id: 2, code: "2", reference: "B-2", shortDescription: "Fita", fullDescription: "Fita" },
    ];
    render(<ProductsPage />);
    expect(screen.getByText(/Corpo em alumínio/)).toBeTruthy();
    // Igual à descrição curta: não repete o texto.
    expect(screen.getAllByText("Fita")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Buscar por referência, descrição ou código de barras"), { target: { value: "aluminio" } });
    expect(screen.getByText("Spot")).toBeTruthy();
    expect(screen.queryByText("Fita")).toBeNull();
  });

  it("descrição longa mostra Ver mais e Ver menos; curta não", () => {
    const base = { imageUrl: null, imageKey: null, barcode: null, unit: "UN", supplierName: null, unitPrice: "10", costPrice: null, stockQuantity: "0", reorderPoint: "0", warrantyMonths: null, active: true, code: "1", reference: "A-1", shortDescription: "Spot" };
    mocks.list.data = [{ ...base, id: 1, fullDescription: "Texto longo do produto" }];
    const heights = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(100);
    render(<ProductsPage />);
    const more = screen.getByRole("button", { name: "Ver mais" });
    expect(screen.getByText("Texto longo do produto").className).toContain("line-clamp-3");
    fireEvent.click(more);
    expect(screen.getByText("Texto longo do produto").className).not.toContain("line-clamp-3");
    fireEvent.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(screen.getByRole("button", { name: "Ver mais" })).toBeTruthy();
    cleanup();
    heights.mockReturnValue(0);
    render(<ProductsPage />);
    expect(screen.queryByRole("button", { name: "Ver mais" })).toBeNull();
    heights.mockRestore();
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

  it("cadastra com a quantidade em estoque e a unidade da lista", () => {
    mocks.list.data = [];
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    fireEvent.change(screen.getByLabelText(/Referência/), { target: { value: "FITA-1" } });
    fireEvent.change(screen.getByLabelText("Descrição curta (vai para o orçamento)"), { target: { value: "Fita" } });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "M" } });
    fireEvent.change(screen.getByLabelText("Quantidade em estoque (M)"), { target: { value: "15,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ unit: "M", initialStock: 15.5 }));
  });

  it("escolhe fornecedor da lista, cria um novo e edita o nome", () => {
    mocks.list.data = [];
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    const field = screen.getByLabelText("Fornecedor") as HTMLSelectElement;
    expect(Array.from(field.options).map(option => option.value)).toEqual(["", "Luminare", "__novo"]);
    fireEvent.change(field, { target: { value: "Luminare" } });
    fireEvent.click(screen.getByRole("button", { name: "Editar nome do fornecedor" }));
    fireEvent.change(screen.getByLabelText("Novo nome do fornecedor"), { target: { value: "Luminare SA" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    expect(mocks.mutate).toHaveBeenCalledWith({ id: 1, name: "Luminare SA" });
    fireEvent.change(field, { target: { value: "__novo" } });
    fireEvent.change(screen.getByLabelText("Nome do novo fornecedor"), { target: { value: "Stella" } });
    fireEvent.change(screen.getByLabelText(/Referência/), { target: { value: "X-1" } });
    fireEvent.change(screen.getByLabelText("Descrição curta (vai para o orçamento)"), { target: { value: "Spot" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ supplierName: "Stella" }));
  });

  it("aceita outra unidade digitada", () => {
    mocks.list.data = [];
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "__outra" } });
    fireEvent.change(screen.getByLabelText("Outra unidade"), { target: { value: "barra" } });
    expect((screen.getByLabelText("Outra unidade") as HTMLInputElement).value).toBe("BARRA");
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

  it("duplica o produto com tudo, inclusive a foto, pedindo nova referência", () => {
    mocks.list.data = [{ id: 9, code: "9", reference: "LM-1", shortDescription: "Spot Lumi", fullDescription: "Spot embutir", imageUrl: "/uploads/products/spot.webp", imageKey: "products/spot.webp", barcode: "111", unit: "CX", supplierName: "Lumi", unitPrice: "89.90", costPrice: "40", stockQuantity: "7", reorderPoint: "2", warrantyMonths: 24, active: true }];
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicar Spot Lumi" }));
    expect(screen.getByText("Duplicar produto")).toBeTruthy();
    expect(screen.queryByText("Rascunho local encontrado")).toBeNull();
    expect((screen.getByLabelText(/Referência/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/Código de barras/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Descrição curta (vai para o orçamento)") as HTMLInputElement).value).toBe("Spot Lumi");
    // Sem a nova referência não salva; a igual à do original também não.
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Referência/), { target: { value: "LM-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    const sent = mocks.mutate.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ reference: "LM-2", barcode: "", shortDescription: "Spot Lumi", fullDescription: "Spot embutir", imageUrl: "/uploads/products/spot.webp", imageKey: "products/spot.webp", unit: "CX", supplierName: "Lumi", unitPrice: 89.9, costPrice: 40, reorderPoint: 2, warrantyMonths: 24, active: true });
    expect(sent.id).toBeUndefined();
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
