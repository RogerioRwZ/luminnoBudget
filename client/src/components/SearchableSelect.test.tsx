// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

const options = [
  { value: "1", label: "LUS-1 · Lustre de Ação", hint: "Físico: 3", searchText: "7891234" },
  { value: "2", label: "ARA-2 · Arandela", searchText: "Luminare" },
  { value: "3", label: "SPT-3 · Spot" },
];
afterEach(cleanup);
const box = () => screen.getByRole("combobox", { name: "Produto" });

describe("SearchableSelect", () => {
  it("acha por qualquer palavra, sem acento nem ordem, inclusive em campos ocultos", () => {
    render(<SearchableSelect ariaLabel="Produto" value="" options={options} onChange={() => {}} />);
    fireEvent.click(box());
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.change(box(), { target: { value: "acao lus" } });
    expect(screen.getAllByRole("option").map((item) => item.textContent)).toEqual(["LUS-1 · Lustre de AçãoFísico: 3"]);
    fireEvent.change(box(), { target: { value: "7891234" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.change(box(), { target: { value: "nada disso" } });
    expect(screen.getByText("Nada encontrado.")).toBeTruthy();
  });

  it("escolhe com clique e com o teclado", () => {
    const onChange = vi.fn();
    render(<SearchableSelect ariaLabel="Produto" value="" options={options} onChange={onChange} />);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole("option", { name: /Spot/ }));
    expect(onChange).toHaveBeenLastCalledWith("3");
    fireEvent.click(box());
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("2");
  });

  it("não deixa o Enter passar para o formulário e o Esc só fecha a lista", () => {
    render(<SearchableSelect ariaLabel="Produto" value="1" options={options} onChange={() => {}} />);
    expect((box() as HTMLInputElement).value).toContain("Lustre");
    fireEvent.click(box());
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("limpa a escolha quando permitido", () => {
    const onChange = vi.fn();
    render(<SearchableSelect ariaLabel="Produto" value="1" options={options} onChange={onChange} clearLabel="Limpar" />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("limita a lista e avisa como refinar", () => {
    const many = Array.from({ length: 900 }, (_, index) => ({ value: String(index + 1), label: `Item ${index + 1}` }));
    render(<SearchableSelect ariaLabel="Produto" value="" options={many} onChange={() => {}} />);
    fireEvent.click(box());
    expect(screen.getAllByRole("option")).toHaveLength(50);
    expect(screen.getByText(/Mostrando 50 de 900/)).toBeTruthy();
  });
});
