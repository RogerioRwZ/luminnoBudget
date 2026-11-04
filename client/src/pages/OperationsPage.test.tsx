// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logSent: vi.fn(),
  pending: [] as any[],
  quoteList: { data: [{ id: 1, quoteNumber: 12, clientName: "Cliente teste", status: "open", summary: { productsSubtotal: 120, discountAmount: 10, shipping: 15, total: 125, pixTotal: 120, installmentValue: 62.5 } }], isLoading: false, error: null as Error | null },
  barcode: { data: null as any, isFetching: false, refetch: vi.fn().mockResolvedValue({ data: null }) },
  mutate: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(),
}));

const query = (key: "versions" | "comments" | "attachments") => ({ data: key === "versions" ? [{ id: 9, quoteId: 1, versionNumber: 2, snapshot: JSON.stringify({ id: 1, quoteNumber: 12, clientName: "Cliente anterior", status: "open", summary: { productsSubtotal: 100, discountAmount: 5, shipping: 10, total: 105, pixTotal: 100, installmentValue: 52.5 }, rooms: [{ name: "Sala", items: [{ shortDescription: "Spot", quantity: 2 }] }] }), changeNote: "Acabamento anterior", createdAt: new Date().toISOString() }] : [], isLoading: false, error: null, refetch: mocks.refetch });
vi.mock("@/lib/trpc", () => ({ trpc: {
  auth: { status: { useQuery: () => ({ data: { user: { role: "admin" } } }) } },
  useUtils: () => ({ product: { list: { invalidate: mocks.invalidate } } }),
  quote: { list: { useQuery: () => mocks.quoteList }, options: { useQuery: () => mocks.quoteList }, get: { useQuery: (input: { id: number }) => ({ data: mocks.quoteList.data?.find((q: { id: number }) => q.id === input.id) }) }, versions: { useQuery: () => query("versions") }, restoreVersion: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, comments: { useQuery: () => query("comments") }, attachments: { useQuery: () => query("attachments") }, createVersion: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, addComment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, resolveComment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) }, uploadAttachment: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) } },
  product: { findByBarcode: { useQuery: () => mocks.barcode } },
  templates: { list: { useQuery: () => ({ data: [], isLoading: false, error: null, refetch: mocks.refetch }) }, save: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) } },
  messages: {
    pending: { useQuery: () => ({ data: mocks.pending, isLoading: false, error: null, refetch: mocks.refetch }) },
    forQuote: { useQuery: () => ({ data: undefined, isLoading: false, error: null }) },
    logSent: { useMutation: () => ({ mutate: mocks.logSent }) },
  },
} }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import OperationsPage from "./OperationsPage";

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.pending = []; mocks.quoteList = { data: [{ id: 1, quoteNumber: 12, clientName: "Cliente teste", status: "open", summary: { productsSubtotal: 120, discountAmount: 10, shipping: 15, total: 125, pixTotal: 120, installmentValue: 62.5 } }], isLoading: false, error: null }; });

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
    expect(screen.getAllByText("R$ 125,00")).toHaveLength(2);
    expect(screen.getAllByText("R$ 105,00")).toHaveLength(2);
    expect(screen.getAllByText("R$ 62,50")).toHaveLength(2);
    expect(screen.getAllByText("R$ 52,50")).toHaveLength(2);
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

  it("lista as mensagens do dia e abre o WhatsApp com o texto preenchido", () => {
    mocks.pending = [{ key: "payment_overdue-7", event: "payment_overdue", eventLabel: "Parcela vencida", quoteId: 1, receivableId: 7, clientName: "Marina", phone: "5511988887777", email: "", subject: "Parcela 2/8 em atraso", body: "Olá, Marina! A parcela 2/8 venceu.", referenceDate: new Date(2026, 9, 20), amount: 150, pix: "" }];
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<OperationsPage />);
    expect(screen.getByText("Mensagens do dia")).toBeTruthy();
    expect(screen.getByText("Marina")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect((dialog.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("Olá, Marina! A parcela 2/8 venceu.");
    fireEvent.click(dialog.getByRole("button", { name: /WhatsApp/ }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/5511988887777\?text=Ol%C3%A1/), "_blank", "noopener,noreferrer");
    expect(mocks.logSent).toHaveBeenCalledWith(expect.objectContaining({ event: "payment_overdue", channel: "whatsapp", receivableId: 7 }));
    open.mockRestore();
  });
});
