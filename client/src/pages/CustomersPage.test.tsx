// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoUnnamedFormControls } from "@/test/formAccessibility";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  statement: vi.fn(),
  mutate: vi.fn(),
  saveOptions: {} as { onSuccess?: () => void },
  invalidate: vi.fn(),
  refetch: vi.fn(),
  list: { data: undefined as any, isLoading: false, error: null as Error | null },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ customers: { list: { invalidate: mocks.invalidate } } }),
    customers: {
      list: { useQuery: () => ({ ...mocks.list, refetch: mocks.refetch }) },
      save: { useMutation: (options: { onSuccess?: () => void }) => { mocks.saveOptions = options; return { isPending: false, mutate: mocks.mutate }; } },
      statement: { useQuery: (input: { id: number }, options: { enabled: boolean }) => (options.enabled ? mocks.statement(input) : { data: undefined, isLoading: false, error: null }) },
    },
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/clientes", mocks.setLocation] }));

import CustomersPage from "./CustomersPage";

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetch.mockReset();
  mocks.list = { data: undefined, isLoading: false, error: null };
});

const maria = { id: 7, name: "Maria Silva", professional: "Arq. Paulo", document: "529.982.247-25", stateRegistration: null, phone: "(11) 99999-0000", email: "maria@email.com", address: null, quoteCount: 2, createdAt: new Date(), updatedAt: new Date() };

describe("CustomersPage — CPF/CNPJ, telefone e e-mail", () => {
  it("formata enquanto digita e não salva número inválido", () => {
    mocks.list.data = [];
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    fireEvent.change(screen.getByLabelText("Nome do cliente *"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("CPF/CNPJ"), { target: { value: "52998224724" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11912345678" } });
    expect((screen.getByLabelText("CPF/CNPJ") as HTMLInputElement).value).toBe("529.982.247-24");
    expect((screen.getByLabelText("Telefone") as HTMLInputElement).value).toBe("(11) 91234-5678");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cliente" }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getAllByText("CPF inválido: confira os números.").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("CPF/CNPJ"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar cliente" }));
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ document: "529.982.247-25", phone: "(11) 91234-5678" }));
  });

  it("depois de salvar, o próximo cliente novo abre em branco", () => {
    mocks.list.data = [];
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    fireEvent.change(screen.getByLabelText("Nome do cliente *"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("CPF/CNPJ"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar cliente" }));
    expect(mocks.mutate).toHaveBeenCalledOnce();
    act(() => mocks.saveOptions.onSuccess?.());
    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    expect((screen.getByLabelText("Nome do cliente *") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("CPF/CNPJ") as HTMLInputElement).value).toBe("");
  });

  it("avisa cliente já cadastrado com o mesmo CPF ou telefone e abre o cadastro", () => {
    mocks.list.data = [maria];
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999990000" } });
    expect(screen.getByText(/Já existe:/).parentElement!.textContent).toContain("Já existe: Maria Silva (telefone (11) 99999-0000)");
    fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro" }));
    expect((screen.getByLabelText("Nome do cliente *") as HTMLInputElement).value).toBe("Maria Silva");
    // Editando a própria Maria, não há aviso.
    expect(screen.queryByText(/Já existe/)).toBeNull();
  });

  it("acha o cliente pelos números do CPF ou telefone, sem pontuação", () => {
    mocks.list.data = [maria, { ...maria, id: 8, name: "João Souza", document: null, phone: "(21) 3123-4567", email: null }];
    render(<CustomersPage />);
    const search = screen.getByLabelText("Buscar por nome, CPF/CNPJ, telefone ou e-mail");
    fireEvent.change(search, { target: { value: "52998224725" } });
    expect(screen.queryByText("Maria Silva")).toBeTruthy();
    expect(screen.queryByText("João Souza")).toBeNull();
    fireEvent.change(search, { target: { value: "2131234567" } });
    expect(screen.queryByText("Maria Silva")).toBeNull();
    expect(screen.queryByText("João Souza")).toBeTruthy();
  });
});

describe("CustomersPage", () => {
  it("nomeia os campos do cadastro de cliente", () => {
    const { container } = render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    expect(screen.getByLabelText("Nome do cliente *")).toBeTruthy();
    expect(screen.getByLabelText("Profissional responsável")).toBeTruthy();
    expect(screen.getByLabelText("Endereço")).toBeTruthy();
    expectNoUnnamedFormControls(container);
  });

  it("informa carregamento e lista vazia", () => {
    mocks.list.isLoading = true;
    const { rerender } = render(<CustomersPage />);
    expect(screen.getByText("Carregando clientes…")).toBeTruthy();
    mocks.list.isLoading = false;
    rerender(<CustomersPage />);
    expect(screen.getByText("Nenhum cliente cadastrado.")).toBeTruthy();
  });

  it("informa falha e permite tentar novamente", () => {
    mocks.list.error = new Error("indisponível");
    render(<CustomersPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar os clientes.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("abre a ficha do cliente com totais e navega até o orçamento", () => {
    mocks.list = { data: [{ id: 5, name: "Marina", professional: "Arq. Paulo", phone: "(11) 98888-7777", quoteCount: 1 }] as any, isLoading: false, error: null };
    mocks.statement.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        quotes: [{ id: 42, quoteNumber: 12, status: "approved", issueDate: new Date(2026, 4, 3), total: 1500 }],
        totals: { quoted: 1500, approved: 1500, received: 500, outstanding: 1000, overdue: 0, conversionRate: 1 },
      },
    });
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: /Histórico/ }));
    expect(mocks.statement).toHaveBeenCalledWith({ id: 5 });
    expect(screen.getByText("Ficha de Marina")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByRole("link", { name: /WhatsApp/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\d+$/);
    fireEvent.click(screen.getByRole("button", { name: /Orçamento #12/ }));
    expect(mocks.setLocation).toHaveBeenCalledWith("/orcamentos/42");
  });
});
