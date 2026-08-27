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
    useUtils: () => ({ customers: { list: { invalidate: mocks.invalidate } } }),
    customers: {
      list: { useQuery: () => ({ ...mocks.list, refetch: mocks.refetch }) },
      save: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
    quote: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import CustomersPage from "./CustomersPage";

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  mocks.refetch.mockReset();
  mocks.list = { data: undefined, isLoading: false, error: null };
});

describe("CustomersPage", () => {
  it("nomeia os campos do cadastro de cliente", () => {
    const { container } = render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    expect(screen.getByLabelText("Nome do cliente *")).toBeTruthy();
    expect(screen.getByLabelText("Profissional responsável *")).toBeTruthy();
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
});
