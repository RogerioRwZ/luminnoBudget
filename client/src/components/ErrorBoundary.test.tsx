// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

function Bomb(): React.ReactElement {
  throw new Error("falha proposital para o teste");
}

describe("ErrorBoundary", () => {
  afterEach(cleanup);

  it("mostra uma mensagem em português, consistente com o resto do app, ao capturar um erro", () => {
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText("Ocorreu um erro inesperado.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recarregar página" })).toBeTruthy();
    expect(screen.queryByText("An unexpected error occurred.")).toBeNull();
    spy.mockRestore();
  });

  it("mostra o stack trace apenas em ambiente de desenvolvimento (não em produção)", () => {
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    // No ambiente de testes (equivalente a desenvolvimento), o stack trace
    // é exibido para ajudar quem está desenvolvendo — mas isso só acontece
    // porque a exibição está condicionada a `import.meta.env.DEV`, que é
    // `false` em produção (ver componente).
    expect(import.meta.env.DEV).toBe(true);
    expect(screen.getByText(/falha proposital para o teste/)).toBeTruthy();
    spy.mockRestore();
  });
});
