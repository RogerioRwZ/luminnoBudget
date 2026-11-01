// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activityInput: vi.fn(),
  activity: { entries: [] as any[], total: 0, page: 1, pageSize: 50, totalPages: 1 },
  invalidate: vi.fn(),
  mutate: vi.fn(),
  refetchStatus: vi.fn(),
  refetchUsers: vi.fn(),
  statusError: null as Error | null,
  usersError: null as Error | null,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      admin: { listUsers: { invalidate: mocks.invalidate }, systemStatus: { invalidate: mocks.invalidate } },
    }),
    admin: {
      systemStatus: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          error: mocks.statusError,
          refetch: mocks.refetchStatus,
        }),
      },
      listUsers: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: mocks.usersError,
          refetch: mocks.refetchUsers,
        }),
      },
      createUser: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      updateUser: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
      resetPassword: { useMutation: () => ({ isPending: false, mutate: mocks.mutate }) },
    },
    activity: {
      list: {
        useQuery: (input: unknown) => {
          mocks.activityInput(input);
          return { data: mocks.activity, isLoading: false, error: null, refetch: vi.fn() };
        },
      },
    },
  },
}));

import AdminPage from "./AdminPage";

afterEach(() => {
  cleanup();
  mocks.statusError = null;
  mocks.usersError = null;
  mocks.invalidate.mockReset();
  mocks.mutate.mockReset();
  mocks.refetchStatus.mockReset();
  mocks.refetchUsers.mockReset();
});

describe("AdminPage", () => {
  it("avisa quando o status do sistema falha ao carregar (em vez de mostrar 'Indisponível' silenciosamente)", () => {
    mocks.statusError = new Error("falha de rede");
    render(<AdminPage />);

    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain(
      "Não foi possível carregar o status do sistema"
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetchStatus).toHaveBeenCalledOnce();
    expect(mocks.refetchUsers).not.toHaveBeenCalled();
  });

  it("avisa quando a lista de usuários falha ao carregar (em vez de mostrar '0 usuários')", () => {
    mocks.usersError = new Error("falha de rede");
    render(<AdminPage />);

    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain(
      "Não foi possível carregar a lista de usuários"
    );
  });

  it("mostra o registro de atividades e filtra por área", () => {
    mocks.activity = {
      entries: [
        { id: 1, userId: 1, userName: "Ana Admin", action: "finance.reversal", entityType: "finance", entityId: 3, summary: "Estornou de R$ 50,00 na parcela 1/2 de Marina", details: null, ip: "10.0.0.5", createdAt: new Date(2026, 10, 1, 9, 30) },
      ],
      total: 1, page: 1, pageSize: 50, totalPages: 1,
    };
    render(<AdminPage />);
    expect(screen.getByText("Registro de atividades")).toBeTruthy();
    expect(screen.getByText("Estornou de R$ 50,00 na parcela 1/2 de Marina")).toBeTruthy();
    expect(screen.getByText(/Ana Admin · IP 10\.0\.0\.5/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Área"), { target: { value: "finance" } });
    expect(mocks.activityInput).toHaveBeenLastCalledWith(expect.objectContaining({ entityType: "finance", page: 1 }));
  });
});
