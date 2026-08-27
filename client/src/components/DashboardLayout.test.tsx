// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("DashboardLayout", () => {
  it("invalida a sessão e retorna ao formulário após a saída", async () => {
    const onLoggedOut = vi.fn();
    render(<DashboardLayout user={{ username: "teste", name: "Rogerio", role: "admin" }} onLoggedOut={onLoggedOut}><p>Conteúdo</p></DashboardLayout>);
    fireEvent.click(screen.getByRole("button", { name: "Sair do sistema" }));

    await waitFor(() => expect(onLoggedOut).toHaveBeenCalledOnce());
    expect(mocks.invalidateStatus).toHaveBeenCalledOnce();
    expect(mocks.invalidateMe).toHaveBeenCalledOnce();
  });
});
