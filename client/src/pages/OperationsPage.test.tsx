// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  quoteList: { data: [{ id: 1, quoteNumber: 12, clientName: "Cliente teste", status: "open" }], isLoading: false, error: null as Error | null },
  barcode: { data: null as any, isFetching: false, refetch: vi.fn().mockResolvedValue({ data: null }) },
  mutate: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(),
}));

const query = (key: "versions" | "comments" | "attachments") => ({ data: key === "versions" ? [{ id: 9, quoteId: 1, versionNumber: 2, snapshot: JSON.stringify({ id: 1, quoteNumber: 12, clientName: "Cliente anterior", status: "open", rooms: [{ name: "Sala", items: [{ shortDescription: "Spot", quantity: 2 }] }] }), changeNote: "Acabamento anterior", createdAt: new Date().toISOString() }] : [], isLoading: false, error: null, refetch: mocks.refetch });
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ product: { list: { invalidate: mocks.invalidate } } }),
  quote: { list: { useQuery: () => mocks.quoteList }, versions: { useQuery: () => query("versions") }, restoreVersion: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, comments: { useQuery: () => query("comments") }, attachments: { useQuery: () => query("attachments") }, createVersion: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, addComment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, resolveComment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, uploadAttachment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) } },
  product: { findByBarcode: { useQuery: () => mocks.barcode } },
  templates: { list: { useQuery: () => ({ data: [], isLoading: false, error: null, refetch: mocks.refetch }) }, save: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) } },
} }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import OperationsPage from "./OperationsPage";

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.quoteList = { data: [{ id: 1, quoteNumber: 12, clientName: "Cliente teste", status: "open" }], isLoading: false, error: null }; });

describe("OperationsPage", () => {
  it("expõe os recursos e controles com nomes acessíveis", () => {
    const { container } = render(<OperationsPage />);
    expect(screen.getByText("Leitor de código de barras")).toBeTruthy();
    expect(screen.getByText("Nova versão da proposta")).toBeTruthy();
    expect(screen.getByText("Comentários internos")).toBeTruthy();
    expect(screen.getByText("Plantas e anexos")).toBeTruthy();
    expect(screen.getByText("Modelos por evento")).toBeTruthy();
    expect(screen.getByLabelText("Código de barras")).toBeTruthy();
    expect(screen.getByLabelText("Novo comentário interno")).toBeTruthy();
    expect(container.querySelectorAll("input, textarea, select").length).toBeGreaterThan(3);
  });

  it("exibe comparação e bloqueia restauração sem justificativa", () => {
    render(<OperationsPage />);
    fireEvent.change(screen.getByLabelText("Orçamento das ferramentas operacionais"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Comparar" }));
    expect(screen.getByText("Comparação antes da restauração")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirmar restauração" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Justificativa obrigatória"), { target: { value: "Correção solicitada pelo cliente" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    expect(mocks.mutate).toHaveBeenCalledWith({ versionId: 9, comment: "Correção solicitada pelo cliente" });
  });

  it("envia a consulta quando um leitor USB termina com Enter", () => {
    render(<OperationsPage />);
    const input = screen.getByLabelText("Código de barras");
    fireEvent.change(input, { target: { value: "789123" } });
    fireEvent.submit(input.closest("form")!);
    expect(mocks.barcode.refetch).toHaveBeenCalledOnce();
  });
});
