// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";
import { Label } from "./label";
import { Textarea } from "./textarea";

describe("controles de formulário acessíveis", () => {
  it("expõe o nome acessível informado pelo formulário", () => {
    render(<div>
      <div className="space-y-2"><Label>Fornecedor</Label><Input aria-label="Fornecedor" /></div>
      <div className="space-y-2"><Label>Observação interna</Label><Textarea aria-label="Observação interna" /></div>
    </div>);

    expect(screen.getByLabelText("Fornecedor")).toBeTruthy();
    expect(screen.getByLabelText("Observação interna")).toBeTruthy();
  });

  it("preserva o nome explícito informado pelo formulário", () => {
    render(<Input aria-label="Buscar produtos" />);

    expect(screen.getByLabelText("Buscar produtos")).toBeTruthy();
  });
});
