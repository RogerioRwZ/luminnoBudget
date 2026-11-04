import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("tema escuro", () => {
  it("avisa o navegador, para listas nativas e datas não saírem brancas", () => {
    const css = read("./index.css");
    expect(css).toMatch(/\.dark \{[^}]*color-scheme: dark/);
    expect(css).toMatch(/select option[^{]*\{[^}]*var\(--popover\)/);
  });

  it("login usa as cores do tema, e não fundo branco fixo", () => {
    expect(read("./pages/AuthPage.tsx")).not.toContain("bg-white text-foreground");
  });
});

describe("orçamento e financeiro no celular", () => {
  it("item mostra total e remover, sem rolagem lateral", () => {
    const mobile = read("./index.css").split("@media (max-width: 640px)")[1]!;
    expect(mobile).toContain('"thumb desc desc desc desc remove"');
    expect(mobile).not.toMatch(/quote-line > :nth-child\(\d\) \{ display: none/);
    expect(mobile).toContain(".stack-table");
  });
});
