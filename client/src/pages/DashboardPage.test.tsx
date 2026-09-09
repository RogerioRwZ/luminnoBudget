// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  error: null as Error | null,
  setLocation: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    dashboard: {
      useQuery: () => ({
        data: undefined,
        isLoading: false,
        error: mocks.error,
        refetch: mocks.refetch,
      }),
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", mocks.setLocation],
}));

import DashboardPage from "./DashboardPage";

afterEach(() => {
  cleanup();
  mocks.error = null;
  mocks.refetch.mockReset();
  mocks.setLocation.mockReset();
});

describe("DashboardPage", () => {
  it("mostra falha ao carregar em vez de números zerados enganosos, e permite tentar de novo", () => {
    mocks.error = new Error("falha de rede");
    render(<DashboardPage />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível carregar o painel."
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
