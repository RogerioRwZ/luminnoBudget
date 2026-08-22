import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const authPage = readFileSync(resolve(root, "client/src/pages/AuthPage.tsx"), "utf8");
const adminPage = readFileSync(resolve(root, "client/src/pages/AdminPage.tsx"), "utf8");

describe("responsividade da administração local", () => {
  it("mantém a autenticação em largura contida e o painel com grades adaptáveis", () => {
    expect(authPage).toContain("max-w-md");
    expect(authPage).toContain("px-4");
    expect(adminPage).toContain("sm:grid-cols-2");
    expect(adminPage).toContain("xl:grid-cols-4");
    expect(adminPage).toContain("xl:grid-cols-[0.8fr_1.2fr]");
    expect(adminPage).toContain("flex-col");
    expect(adminPage).toContain("Administração segura");
    expect(adminPage).toContain("Sistema e usuários");
    expect(adminPage).toContain("Acessos cadastrados");
    expect(adminPage).toContain("Novo usuário");
    expect(adminPage).toContain("Informações operacionais");
  });
});
