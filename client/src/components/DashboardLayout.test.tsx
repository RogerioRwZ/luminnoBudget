// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onSuccess: undefined as undefined | (() => void | Promise<void>),
  invalidateStatus: vi.fn(),
  invalidateMe: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { status: { invalidate: mocks.invalidateStatus }, me: { invalidate: mocks.invalidateMe } } }),
    auth: {
      me: { useQuery: () => ({ data: { name: "Rogerio" } }) },
      logout: { useMutation: ({ onSuccess }: { onSuccess: () => void | Promise<void> }) => ({ mutate: () => { mocks.onSuccess = onSuccess; void onSuccess(); } }) },
    },
  },
}));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

import DashboardLayout from "./DashboardLayout";

type Role = "user" | "admin" | "sales" | "stock" | "finance";
function renderLayout(role: Role, health: { ok: boolean; database: string }, onLoggedOut = vi.fn()) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: health.ok, json: async () => ({ database: health.database }) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DashboardLayout user={{ username: "teste", name: "Rogerio", role }} onLoggedOut={onLoggedOut}><p>Conteúdo</p></DashboardLayout></QueryClientProvider>);
  return onLoggedOut;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardLayout", () => {
  it("invalida a sessão e retorna ao formulário após a saída", async () => {
    const onLoggedOut = renderLayout("admin", { ok: true, database: "online" });
    fireEvent.click(screen.getByRole("button", { name: "Sair do sistema" }));

    await waitFor(() => expect(onLoggedOut).toHaveBeenCalledOnce());
    expect(mocks.invalidateStatus).toHaveBeenCalledOnce();
    expect(mocks.invalidateMe).toHaveBeenCalledOnce();
  });

  it("mostra o estado real do sistema a partir de /api/health", async () => {
    renderLayout("admin", { ok: false, database: "offline" });
    expect(await screen.findByText("Sistema indisponível")).toBeTruthy();
  });

  it("mostra o atalho de backup e a Administração só para administradores", async () => {
    renderLayout("user", { ok: true, database: "online" });
    expect(await screen.findByText("Sistema ativo")).toBeTruthy();
    expect(screen.queryByText("Backup manual")).toBeNull();
    expect(screen.queryByText("Administração")).toBeNull();
  });

  it("mostra no menu só as áreas do perfil", async () => {
    renderLayout("stock", { ok: true, database: "online" });
    expect(await screen.findByText("Sistema ativo")).toBeTruthy();
    for (const label of ["Estoque", "Compras", "Agenda", "Catálogo"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    for (const label of ["Orçamentos", "Financeiro", "Clientes"]) expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(screen.getByText(/Expedição e estoque/)).toBeTruthy();
  });
});
