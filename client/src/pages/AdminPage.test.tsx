// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
});
