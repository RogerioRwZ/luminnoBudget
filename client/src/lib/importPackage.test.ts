// @vitest-environment jsdom
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readImportFile } from "./importPackage";
import { buildXlsx, readXlsx } from "./xlsx";

type Item = { name: string | Buffer; data: Uint8Array; store?: boolean; flags?: number };
function zip(items: Item[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.isBuffer(item.name) ? item.name : Buffer.from(item.name);
    const flags = item.flags ?? (Buffer.isBuffer(item.name) ? 0 : 0x0800);
    const data = item.store ? Buffer.from(item.data) : deflateRawSync(item.data);
    const method = item.store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(item.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(item.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new File([Buffer.concat([...parts, centralBytes, end])], "pacote.zip");
}

const sheet = buildXlsx([{ name: "Produtos", rows: [["Referência *"], ["A"]] }]);
const image = new Uint8Array([1, 2, 3, 4]);

describe("readImportFile", () => {
  it("aceita a planilha sozinha, mesmo sem extensão certa", async () => {
    const result = await readImportFile(new File([sheet as BlobPart], "qualquer.zip"));
    expect(result.photos).toEqual([]);
    expect((await readXlsx(result.sheet))[0]!.rows[1]).toEqual(["A"]);
  });

  it("separa planilha e fotos, em pastas e ignorando o lixo do Mac e do Excel", async () => {
    const result = await readImportFile(zip([
      { name: "catalogo/", data: new Uint8Array(), store: true },
      { name: "catalogo/produtos.xlsx", data: sheet },
      { name: "__MACOSX/catalogo/._produtos.xlsx", data: image },
      { name: "catalogo/~$produtos.xlsx", data: image },
      { name: "catalogo/fotos/Lustre.JPG", data: image, store: true },
      { name: "b.png", data: image },
      { name: "c.webp", data: image },
      { name: "d.heic", data: image },
      { name: "leia-me.txt", data: image },
    ]));
    expect((await readXlsx(result.sheet))[0]!.rows[1]).toEqual(["A"]);
    expect(result.photos.map((file) => [file.name, file.type])).toEqual([["Lustre.JPG", "image/jpeg"], ["b.png", "image/png"], ["c.webp", "image/webp"], ["d.heic", ""]]);
    expect(new Uint8Array(await result.photos[1]!.arrayBuffer())).toEqual(image);
  });

  it("lê nomes com acento gravados pelo Windows antigo e pelo Mac", async () => {
    const result = await readImportFile(zip([
      { name: "p.xlsx", data: sheet },
      { name: Buffer.from([0x61, 0x87, 0xc6, 0x6f, 0x2e, 0x6a, 0x70, 0x67]), data: image },
      { name: Buffer.from("lâmpada.jpg"), data: image },
    ]));
    expect(result.photos[1]!.name).toBe("lâmpada.jpg");
    expect(result.photos[0]!.name).toContain("ç");
  });

  it("avisa sobre fotos com o mesmo nome", async () => {
    const result = await readImportFile(zip([{ name: "p.xlsx", data: sheet }, { name: "a/x.jpg", data: image }, { name: "b/X.JPG", data: image }]));
    expect(result.duplicates).toEqual(["X.JPG"]);
  });

  it("explica cada .zip que não serve", async () => {
    await expect(readImportFile(zip([{ name: "x.jpg", data: image }]))).rejects.toThrow("Não achei a planilha");
    await expect(readImportFile(zip([{ name: "x.csv", data: image }]))).rejects.toThrow("em .xlsx");
    await expect(readImportFile(zip([{ name: "a.xlsx", data: sheet }, { name: "b.xlsx", data: sheet }]))).rejects.toThrow("mais de uma planilha");
    await expect(readImportFile(zip([{ name: "a.xlsx", data: sheet, flags: 0x0801 }]))).rejects.toThrow("senha");
    await expect(readImportFile(new File(["nada"], "a.zip"))).rejects.toThrow("não é uma planilha");
  });

  it("não deixa uma planilha gigante comprimida estourar a memória", async () => {
    await expect(readImportFile(zip([{ name: "a.xlsx", data: new Uint8Array(30 * 1024 * 1024) }]))).rejects.toThrow("grande demais");
  });

  it("recusa ZIP corrompido", async () => {
    const good = zip([{ name: "a.xlsx", data: sheet }, { name: "x.jpg", data: image }]);
    const bytes = new Uint8Array(await good.arrayBuffer());
    bytes.fill(0xff, 40, 200);
    await expect(readImportFile(new File([bytes], "a.zip"))).rejects.toThrow();
  });
});
