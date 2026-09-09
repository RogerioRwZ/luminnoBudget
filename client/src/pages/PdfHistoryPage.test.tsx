// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: [] as Array<{ id: number; quoteId: number; quoteNumber: number | null; clientName: string | null; fileName: string; fileSize: number; createdAt: Date; downloadUrl: string }>,
  setLocation: vi.fn(),
  refetch: vi.fn(),
  error: null as Error | null,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { quote: { pdfHistoryAll: { useQuery: () => ({ data: mocks.error ? undefined : mocks.entries, isLoading: false, error: mocks.error, refetch: mocks.refetch }) } } },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/historico-pdfs", mocks.setLocation],
}));

import PdfHistoryPage from "./PdfHistoryPage";

afterEach(() => {
  mocks.entries = [];
  mocks.error = null;
  mocks.setLocation.mockReset();
  mocks.refetch.mockReset();
  vi.restoreAllMocks();
});

describe("PdfHistoryPage", () => {
  it("lista o PDF salvo e aciona o download rápido", () => {
    mocks.entries = [{ id: 7, quoteId: 3, quoteNumber: 18, clientName: "Clínica Aurora", fileName: "orcamento-0018.pdf", fileSize: 1200, createdAt: new Date("2026-08-25T12:00:00.000Z"), downloadUrl: "/api/quote-pdfs/7/download" }];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<PdfHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));

    expect(screen.getByText("Clínica Aurora")).toBeTruthy();
    expect(screen.getByText("Orçamento #18")).toBeTruthy();
    expect(click).toHaveBeenCalledOnce();
  });

  it("mostra falha ao carregar (em vez de parecer 'nenhum PDF gerado') e permite tentar de novo", () => {
    mocks.error = new Error("falha de rede");
    render(<PdfHistoryPage />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível carregar o histórico de PDFs."
    );
    expect(screen.queryByText("Nenhum PDF gerado ainda.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
