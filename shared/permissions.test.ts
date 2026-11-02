import { describe, expect, it } from "vitest";
import { canAccess, canOpenPage } from "./permissions";

describe("permissões por perfil", () => {
  it("vendas não vê financeiro, estoque nem compras", () => {
    expect(canAccess("sales", "quotes")).toBe(true);
    expect(canAccess("sales", "finance")).toBe(false);
    expect(canOpenPage("sales", "/estoque/conferencia/3")).toBe(false);
    expect(canOpenPage("sales", "/compras")).toBe(false);
  });
  it("expedição fica com estoque, conferência, compras e agenda", () => {
    expect(canOpenPage("stock", "/estoque/conferencia/3")).toBe(true);
    expect(canOpenPage("stock", "/orcamentos/3")).toBe(false);
    expect(canOpenPage("stock", "/financeiro")).toBe(false);
    expect(canOpenPage("stock", "/agenda")).toBe(true);
  });
  it("perfis antigos continuam com acesso completo e páginas comuns abrem para todos", () => {
    expect(canAccess("user", "finance", "stock")).toBe(true);
    expect(canOpenPage("finance", "/")).toBe(true);
    expect(canOpenPage("stock", "/configuracoes")).toBe(true);
    expect(canAccess(undefined, "quotes")).toBe(false);
  });
});
