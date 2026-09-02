// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AsyncButton,
  FormError,
  getFormErrorMessage,
} from "./FormFeedback";

describe("FormFeedback", () => {
  it("transforma falha de credenciais em uma orientação clara", () => {
    expect(getFormErrorMessage(new Error("Invalid credentials"))).toBe(
      "Usuário ou senha incorretos. Confira os dados e tente novamente."
    );
  });

  it("não renderiza erro quando a mutação ainda não falhou", () => {
    render(<FormError message={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("bloqueia o botão e anuncia a operação enquanto está pendente", () => {
    render(
      <AsyncButton pending loadingLabel="Salvando cadastro…">
        Salvar cadastro
      </AsyncButton>
    );

    const button = screen.getByRole("button", { name: "Salvando cadastro…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector('svg[aria-label="Carregando"]')).toBeTruthy();
  });
});
