// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ entries: [] as Array<{ id: number; fileName: string; fileSize: number; createdAt: Date; downloadUrl: string }> }));

vi.mock("@/lib/trpc", () => ({
  trpc: { quote: { pdfHistory: { useQuery: () => ({ data: mocks.entries, isLoading: false, isError: false }) } } },
}));

import { QuotePdfHistoryPanel } from "./QuotePdfHistoryPanel";

afterEach(() => {
  mocks.entries = [];
  vi.restoreAllMocks();
});

describe("QuotePdfHistoryPanel", () => {
  it("exibe o estado vazio quando ainda não existe uma versão salva", () => {
    render(<QuotePdfHistoryPanel quoteId={3} />);
    expect(screen.getByText("Nenhum PDF salvo neste orçamento.")).toBeTruthy();
  });

  it("lista uma versão gerada e permite baixá-la", () => {
    mocks.entries = [{ id: 1, fileName: "orcamento-0003.pdf", fileSize: 1600, createdAt: new Date("2026-08-25T12:00:00.000Z"), downloadUrl: "/api/quote-pdfs/1/download" }];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<QuotePdfHistoryPanel quoteId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));

    expect(screen.getByText("orcamento-0003.pdf")).toBeTruthy();
    expect(click).toHaveBeenCalledOnce();
  });
});
