import { describe, expect, it } from "vitest";
import { csvFileName, toCsv } from "./csv";

describe("exportação CSV", () => {
  it("usa ponto e vírgula, vírgula decimal e aspas quando necessário", () => {
    const csv = toCsv([{ name: 'Spot "LED"; 7W', price: 1234.5, active: true }], [
      { header: "Produto", value: (row) => row.name },
      { header: "Preço", value: (row) => row.price },
      { header: "Ativo", value: (row) => row.active },
    ]);
    expect(csv).toBe('Produto;Preço;Ativo\r\n"Spot ""LED""; 7W";1234,5;Sim');
  });

  it("neutraliza células que seriam interpretadas como fórmula", () => {
    const csv = toCsv([{ name: "=HYPERLINK(\"http://x\")" }, { name: "-10" }, { name: "@SUM(A1)" }], [{ header: "Nome", value: (row) => row.name }]);
    expect(csv.split("\r\n").slice(1)).toEqual(['"\'=HYPERLINK(""http://x"")"', "'-10", "'@SUM(A1)"]);
  });

  it("formata datas e valores vazios", () => {
    const csv = toCsv([{ when: new Date(2026, 2, 5), empty: null }], [
      { header: "Data", value: (row) => row.when },
      { header: "Vazio", value: (row) => row.empty },
    ]);
    expect(csv).toBe("Data;Vazio\r\n05/03/2026;");
    expect(csvFileName("orcamentos", new Date(2026, 9, 29))).toBe("orcamentos-2026-10-29.csv");
  });
});
