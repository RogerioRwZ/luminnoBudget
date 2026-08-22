import { describe, expect, it } from "vitest";
import { matchesQuoteStatusFilter } from "./quoteStatus";

describe("matchesQuoteStatusFilter", () => {
  it("inclui rascunhos e orçamentos abertos como pendentes", () => {
    expect(matchesQuoteStatusFilter("draft", "pending")).toBe(true);
    expect(matchesQuoteStatusFilter("open", "pending")).toBe(true);
    expect(matchesQuoteStatusFilter("approved", "pending")).toBe(false);
  });

  it("separa propostas aprovadas e rejeitadas", () => {
    expect(matchesQuoteStatusFilter("approved", "approved")).toBe(true);
    expect(matchesQuoteStatusFilter("lost", "lost")).toBe(true);
    expect(matchesQuoteStatusFilter("lost", "approved")).toBe(false);
    expect(matchesQuoteStatusFilter("approved", "all")).toBe(true);
  });
});
