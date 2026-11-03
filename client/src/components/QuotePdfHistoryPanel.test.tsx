// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Entry = { id: number; fileName: string; fileSize: number; createdAt: Date; rebuild: boolean; downloadUrl: string | null };
const mocks = vi.hoisted(() => ({
  entries: [] as Entry[],
  fetchSnapshot: vi.fn(async () => ({ fileName: "Orçamento 0003 - Ana.pdf", snapshot: '{"rooms":[],"summary":{}}' })),
  build: vi.fn(async () => ({ blob: new Blob(["%PDF"]), failedImageCount: 0 })),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ quote: { pdfSnapshot: { fetch: mocks.fetchSnapshot } } }),
    quote: { pdfHistory: { useQuery: () => ({ data: mocks.entries, isLoading: false, isError: false }) } },
  },
}));
vi.mock("@/lib/quotePdf", () => ({ createQuotePdfBlob: mocks.build, fromPdfSnapshot: (text: string) => JSON.parse(text) }));

import { QuotePdfHistoryPanel } from "./QuotePdfHistoryPanel";

afterEach(() => {
  cleanup();
  mocks.entries = [];
  mocks.fetchSnapshot.mockClear();
  mocks.build.mockClear();
  vi.restoreAllMocks();
});

describe("QuotePdfHistoryPanel", () => {
  it("exibe o estado vazio quando ainda não existe uma versão salva", () => {
    render(<QuotePdfHistoryPanel quoteId={3} />);
    expect(screen.getByText("Nenhum PDF salvo neste orçamento.")).toBeTruthy();
  });

  it("PDF antigo baixa o arquivo guardado", () => {
    mocks.entries = [{ id: 1, fileName: "orcamento-0003.pdf", fileSize: 1600, createdAt: new Date("2026-08-25T12:00:00.000Z"), rebuild: false, downloadUrl: "/api/quote-pdfs/1/download" }];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<QuotePdfHistoryPanel quoteId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    expect(screen.getByText("orcamento-0003.pdf")).toBeTruthy();
    expect(click).toHaveBeenCalledOnce();
    expect(mocks.fetchSnapshot).not.toHaveBeenCalled();
  });

  it("PDF novo é montado no navegador a partir dos dados guardados", async () => {
    mocks.entries = [{ id: 2, fileName: "Orçamento 0003 - Ana.pdf", fileSize: 90_000, createdAt: new Date(), rebuild: true, downloadUrl: null }];
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<QuotePdfHistoryPanel quoteId={3} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    });
    expect(mocks.fetchSnapshot).toHaveBeenCalledWith({ id: 2 });
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});
