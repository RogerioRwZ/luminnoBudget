// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Qualquer rota do tRPC responde "sem dados": confere que a tela abre vazia,
// sem erro, e com o próprio título.
const mocks = vi.hoisted(() => {
  const query = () => ({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: () => undefined });
  const mutation = () => ({ isPending: false, mutate: () => undefined, mutateAsync: () => undefined });
  const anyRoute = (): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => (key === "useQuery" ? query : key === "useMutation" ? mutation : key === "useUtils" ? anyRoute : anyRoute()),
      apply: () => anyRoute(),
    });
  return { anyRoute };
});

vi.mock("@/lib/trpc", () => ({ trpc: mocks.anyRoute() }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/", () => undefined],
  useParams: () => ({ id: "1" }),
  useSearch: () => "",
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, role: "admin" }) }));

import AgendaPage from "./AgendaPage";
import CommissionsPage from "./CommissionsPage";
import LoansPage from "./LoansPage";
import NotFound from "./NotFound";
import PickingCheckPage from "./PickingCheckPage";
import PurchasesPage from "./PurchasesPage";
import ReportsPage from "./ReportsPage";
import StockTurnoverPage from "./StockTurnoverPage";

afterEach(cleanup);

describe("telas abrem sem dados", () => {
  it.each([
    ["Agenda", AgendaPage, /Agenda/],
    ["Comissões", CommissionsPage, /Comissões/],
    ["Mostruário", LoansPage, /Mostruário/],
    ["Compras", PurchasesPage, /Compras/],
    ["Relatórios", ReportsPage, /Relatório/],
    ["Giro", StockTurnoverPage, /Giro/],
    ["Não encontrada", NotFound, /404|não encontrada/i],
  ])("%s", (_name, Page, title) => {
    render(<Page />);
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  });

  it("Conferência avisa quando não há orçamento", () => {
    render(<PickingCheckPage />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar");
  });
});
