import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const publicDocument = readFileSync(resolve(root, "client/index.html"), "utf8");
const dashboardLayout = readFileSync(resolve(root, "client/src/components/DashboardLayout.tsx"), "utf8");

describe("identidade pública da Luminno", () => {
  it("mantém o título e a identidade Luminno sem créditos ou rastreadores externos no documento público", () => {
    expect(publicDocument).toContain("<title>Luminno Orçamentos</title>");
    expect(dashboardLayout).toContain("Luminno");
    expect(publicDocument).not.toMatch(/manus|umami|powered by|feito por|desenvolvido por|created by|built by/i);
    expect(dashboardLayout).not.toMatch(/manus|powered by|feito por|desenvolvido por|created by|built by/i);
  });
});
