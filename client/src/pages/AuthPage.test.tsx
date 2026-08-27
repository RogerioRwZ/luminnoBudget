// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loginOptions: undefined as { onError?: (error: Error) => void; onSuccess?: () => void | Promise<void> } | undefined,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  invalidateStatus: vi.fn(),
  invalidateMe: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { status: { invalidate: mocks.invalidateStatus }, me: { invalidate: mocks.invalidateMe } } }),
    auth: {
      status: { useQuery: vi.fn() },
      login: {
        useMutation: (options: { onError?: (error: Error) => void }) => {
          mocks.loginOptions = options;
          return {
            isPending: false,
            mutate: vi.fn(() => options.onError?.(new Error("Too many login attempts; try again later"))),
          };
        },
      },
      setup: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
    },
  },
}));

import AuthPage from "./AuthPage";

describe("AuthPage", () => {
  beforeEach(() => {
    mocks.loginOptions = undefined;
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.invalidateStatus.mockReset();
    mocks.invalidateMe.mockReset();
  });

  it("exibe no toast o rate limit retornado pelo login", () => {
    render(<AuthPage setupRequired={false} />);
    fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "ana.silva" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-forte-com-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(mocks.loginOptions).toBeDefined();
    expect(mocks.toastError).toHaveBeenCalledWith("Muitas tentativas de login. Aguarde alguns minutos e tente novamente.");
  });

  it("revalida a sessão e redireciona após o servidor aceitar o login", async () => {
    const onAuthenticated = vi.fn();
    render(<AuthPage setupRequired={false} onAuthenticated={onAuthenticated} />);

    await mocks.loginOptions?.onSuccess?.();

    expect(mocks.toastSuccess).toHaveBeenCalledWith("Acesso liberado.");
    expect(mocks.invalidateStatus).toHaveBeenCalledOnce();
    expect(mocks.invalidateMe).toHaveBeenCalledOnce();
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });
});
