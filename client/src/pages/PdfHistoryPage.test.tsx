// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: [] as Array<{ id: number; quoteId: number; quoteNumber: number | null; clientName: string | null; fileName: string; fileSize: number; createdAt: Date; downloadUrl: string }>,
  setLocation: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { quote: { pdfHistoryAll: { useQuery: () => ({ data: mocks.entries, isLoading: false }) } } },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/historico-pdfs", mocks.setLocation],
}));

import PdfHistoryPage from "./PdfHistoryPage";

afterEach(() => {
  mocks.entries = [];
  mocks.setLocation.mockReset();
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
});
