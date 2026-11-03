import { describe, expect, it } from "vitest";
import { contactKey, documentProblem, emailProblem, formatDocument, formatPhone, matchesClientSearch, normalizeDocument, normalizeEmail, normalizePhone, phoneProblem } from "./contact";

describe("CPF e CNPJ", () => {
  it("monta o formato enquanto digita", () => {
    expect(formatDocument("529")).toBe("529");
    expect(formatDocument("5299822")).toBe("529.982.2");
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("112223330001")).toBe("11.222.333/0001");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(formatDocument("529.982.247-25999")).toBe("52.998.224/7259-99");
  });

  it("confere os dígitos verificadores (CNPJ com letras incluído)", () => {
    expect(documentProblem("")).toBeNull();
    expect(documentProblem("529.982.247-25")).toBeNull();
    expect(documentProblem("529.982.247-24")).toMatch(/CPF inválido/);
    expect(documentProblem("111.111.111-11")).toMatch(/CPF inválido/);
    expect(documentProblem("11.222.333/0001-81")).toBeNull();
    expect(documentProblem("11.222.333/0001-80")).toMatch(/CNPJ inválido/);
    expect(documentProblem("12.ABC.345/01DE-35")).toBeNull();
    expect(documentProblem("12.ABC.345/01DE-34")).toMatch(/CNPJ inválido/);
    expect(documentProblem("123.456")).toMatch(/11 dígitos/);
  });

  it("grava no padrão quando completo", () => {
    expect(normalizeDocument(" 52998224725 ")).toBe("529.982.247-25");
    expect(normalizeDocument("123")).toBe("123");
    expect(normalizeDocument("  ")).toBeNull();
  });
});

describe("telefone", () => {
  it("monta celular e fixo e tira +55 e 0 da operadora", () => {
    expect(formatPhone("1")).toBe("(1");
    expect(formatPhone("11")).toBe("(11");
    expect(formatPhone("119")).toBe("(11) 9");
    expect(formatPhone("1131234567")).toBe("(11) 3123-4567");
    expect(formatPhone("11912345678")).toBe("(11) 91234-5678");
    expect(formatPhone("+55 11 91234-5678")).toBe("(11) 91234-5678");
    expect(formatPhone("011 3123 4567")).toBe("(11) 3123-4567");
    expect(normalizePhone("11 99999-0000")).toBe("(11) 99999-0000");
    expect(normalizePhone("ramal 20")).toBe("ramal 20");
  });

  it("confere a quantidade de dígitos e o 9 do celular", () => {
    expect(phoneProblem("")).toBeNull();
    expect(phoneProblem("(11) 91234-5678")).toBeNull();
    expect(phoneProblem("(11) 3123-4567")).toBeNull();
    expect(phoneProblem("(11) 81234-5678")).toMatch(/começar com 9/);
    expect(phoneProblem("1234")).toMatch(/DDD/);
  });
});

describe("e-mail e busca", () => {
  it("e-mail sem espaços, em minúsculas e com formato válido", () => {
    expect(normalizeEmail("  Maria@Email.com ")).toBe("maria@email.com");
    expect(emailProblem("maria@email.com")).toBeNull();
    expect(emailProblem("maria@email")).toMatch(/inválido/);
    expect(emailProblem("maria email.com")).toMatch(/inválido/);
  });

  it("acha o cliente pelos números, com ou sem pontuação", () => {
    const client = { name: "Maria Silva", professional: "Arq. Paulo", document: "529.982.247-25", phone: "(11) 99999-0000", email: "maria@email.com" };
    expect(matchesClientSearch(client, "52998224725")).toBe(true);
    expect(matchesClientSearch(client, "529.982")).toBe(true);
    expect(matchesClientSearch(client, "11999990000")).toBe(true);
    expect(matchesClientSearch(client, "(11) 99999")).toBe(true);
    expect(matchesClientSearch(client, "paulo")).toBe(true);
    expect(matchesClientSearch(client, "maria@")).toBe(true);
    expect(matchesClientSearch(client, "88888")).toBe(false);
    expect(contactKey("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
  });
});
