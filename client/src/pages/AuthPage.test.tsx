// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loginOptions: undefined as { onError?: (error: Error) => void } | undefined,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { status: { invalidate: vi.fn() }, me: { invalidate: vi.fn() } } }),
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
  });

  it("exibe no toast o rate limit retornado pelo login", () => {
    render(<AuthPage setupRequired={false} />);
    fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "ana.silva" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-forte-com-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(mocks.loginOptions).toBeDefined();
    expect(mocks.toastError).toHaveBeenCalledWith("Muitas tentativas de login. Aguarde alguns minutos e tente novamente.");
  });
});
