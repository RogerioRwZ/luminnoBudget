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
      saveWithVariants: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      saveFamily: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
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

  it("cadastra o produto já com as variações, cada uma com a sua referência", () => {
    mocks.list.data = [];
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    fireEvent.change(screen.getByLabelText("Descrição curta (vai para o orçamento)"), { target: { value: "Pendente Arco" } });
    fireEvent.click(screen.getByRole("switch", { name: "Este produto tem variações" }));
    // O modelo não pede referência nem código de barras: ficam nas variações.
    expect(document.getElementById("product-reference")).toBeNull();
    expect(document.getElementById("product-barcode")).toBeNull();
    // Primeira linha já aberta; a segunda, sem detalhe nenhum, só com referência.
    fireEvent.change(screen.getByLabelText("Cor / acabamento da variação 1"), { target: { value: "Preto" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar variação" }));
    // Referência é obrigatória: sem ela não salva.
    fireEvent.click(screen.getByRole("button", { name: "Salvar com 2 variações" }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getAllByText("Informe a referência.")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Referência da variação 1"), { target: { value: "ARCO/PT" } });
    fireEvent.change(screen.getByLabelText("Referência da variação 2"), { target: { value: "ARCO-LISO" } });
    fireEvent.change(screen.getByLabelText("Código de barras da variação 2"), { target: { value: "789 100" } });
    expect(screen.getByText("Pendente Arco — Ref. ARCO-LISO")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar com 2 variações" }));
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({ reference: undefined, shortDescription: "Pendente Arco", attributes: null, barcode: null }),
      variants: [
        { attributes: { color: "Preto" }, reference: "ARCO/PT", barcode: null },
        { attributes: {}, reference: "ARCO-LISO", barcode: "789100" },
      ],
    }));
  });

  it("gera combinações com a referência em branco e o atalho preenche só as vazias", () => {
    mocks.list.data = [];
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    fireEvent.click(screen.getByRole("switch", { name: "Este produto tem variações" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover a variação 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar combinações/ }));
    fireEvent.change(screen.getByLabelText("Cor / acabamento"), { target: { value: "Preto, Branco" } });
    fireEvent.change(screen.getByLabelText("Potência"), { target: { value: "7, 12" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar combinações" }));
    expect((screen.getByLabelText("Referência da variação 1") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Potência da variação 4") as HTMLInputElement).value).toBe("12W");
    fireEvent.change(screen.getByLabelText("Referência da variação 2"), { target: { value: "MINHA-REF" } });
    fireEvent.change(screen.getByLabelText(/preencher as referências vazias/), { target: { value: "TRX" } });
    fireEvent.click(screen.getByRole("button", { name: /Preencher vazias/ }));
    expect([1, 2, 3, 4].map(n => (screen.getByLabelText(`Referência da variação ${n}`) as HTMLInputElement).value)).toEqual(["TRX-PRETO-7W", "MINHA-REF", "TRX-BRANCO-7W", "TRX-BRANCO-12W"]);
  });

  it("editar um modelo mostra cada variação com a sua referência e código de barras", () => {
    const base = { fullDescription: null, imageUrl: null, imageKey: null, unit: "UN", supplierName: null, unitPrice: "90", reorderPoint: "0", active: true, modelName: "Arandela", stockQuantity: "0" };
    mocks.list.data = [
      { ...base, id: 10, code: "10", reference: "MOD-10", shortDescription: "Arandela", barcode: null, parentId: null, attributes: null },
      { ...base, id: 11, code: "11", reference: "AR-PT", shortDescription: "Arandela — Preto", barcode: "111", parentId: 10, attributes: '{"color":"Preto"}' },
      { ...base, id: 12, code: "12", reference: "AR-BR", shortDescription: "Arandela — Branco", barcode: null, parentId: 10, attributes: '{"color":"Branco"}' },
    ];
    render(<ProductsPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    // Em ordem alfabética, como no catálogo.
    expect((screen.getByLabelText("Referência da variação 2") as HTMLInputElement).value).toBe("AR-PT");
    expect((screen.getByLabelText("Código de barras da variação 2") as HTMLInputElement).value).toBe("111");
    // Variações já gravadas não têm o botão de remover.
    expect(screen.queryByRole("button", { name: "Remover a variação 1" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Referência da variação 1"), { target: { value: "AR/BR" } });
    fireEvent.change(screen.getByLabelText("Código de barras da variação 1"), { target: { value: "222" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar com 2 variações" }));
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({ id: 10, reference: "MOD-10" }),
      variants: [
        { id: 12, attributes: { color: "Branco" }, reference: "AR/BR", barcode: "222" },
        { id: 11, attributes: { color: "Preto" }, reference: "AR-PT", barcode: "111" },
      ],
    }));
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
      { ...base, id: 1, code: "1", reference: "GU10", shortDescription: "Spot GU10 — Preto · 3000K", barcode: null, stockQuantity: "4", parentId: null, attributes: '{"color":"Preto","colorTemperature":"3000K"}' },
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
    // A referência da variação é digitada (não é preenchida sozinha).
    expect((screen.getByLabelText(/Referência/) as HTMLInputElement).value).toBe("");
    // Digitada pela pessoa, a referência não muda mais sozinha.
    fireEvent.change(screen.getByLabelText(/Referência/), { target: { value: "GU10/DR" } });
    fireEvent.change(screen.getByLabelText("Cor / acabamento"), { target: { value: "Ouro" } });
    expect((screen.getByLabelText(/Referência/) as HTMLInputElement).value).toBe("GU10/DR");
  });
});
