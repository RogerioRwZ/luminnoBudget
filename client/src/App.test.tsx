// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ authenticated: false }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      status: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: state.authenticated
            ? { setupRequired: false, user: { username: "teste", name: "Rogerio", role: "admin" as const } }
            : { setupRequired: false, user: null },
        }),
      },
    },
  },
}));

vi.mock("@/pages/AuthPage", () => ({ default: () => <p>Formulário de login</p> }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <section aria-label="Área protegida">{children}</section> }));
vi.mock("@/pages/DashboardPage", () => ({ default: () => <p>Painel protegido</p> }));
vi.mock("@/pages/AdminPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/CustomersPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/FinancePage", () => ({ default: () => <p /> }));
vi.mock("@/pages/InventoryPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/PdfHistoryPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/ProductsPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/QuoteEditorPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/QuotesPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/SettingsPage", () => ({ default: () => <p /> }));
vi.mock("@/pages/NotFound", () => ({ default: () => <p /> }));

import { Router } from "./App";

describe("Router de autenticação", () => {
  afterEach(cleanup);

  it("troca do formulário para a área protegida assim que auth.status reconhece a sessão", () => {
    state.authenticated = false;
    const view = render(<Router />);
    expect(screen.getByText("Formulário de login")).toBeTruthy();

    state.authenticated = true;
    view.rerender(<Router />);

    expect(screen.getByRole("region", { name: "Área protegida" })).toBeTruthy();
    expect(screen.getByText("Painel protegido")).toBeTruthy();
  });

  it("retorna ao formulário quando auth.status passa a não ter usuário após logout", () => {
    state.authenticated = true;
    const view = render(<Router />);
    expect(screen.getByRole("region", { name: "Área protegida" })).toBeTruthy();

    // Após logout bem-sucedido, a consulta de status não deve mais reconhecer a sessão.
    state.authenticated = false;
    view.rerender(<Router />);

    expect(screen.getByText("Formulário de login")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Área protegida" })).toBeNull();
  });
});
