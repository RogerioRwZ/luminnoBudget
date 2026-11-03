// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), qr: vi.fn(async () => "data:image/png;base64,iVBORw0KGgo=") }));
vi.mock("@/lib/trpc", () => ({ trpc: { messages: { logSent: { useMutation: () => ({ mutate: mocks.mutate }) } } } }));
vi.mock("@/lib/pixQr", () => ({ pixQrDataUrl: mocks.qr }));

import { MessageDialog, type DialogMessage } from "./MessageDialog";

const message = { key: "payment_due-7", event: "payment_due", eventLabel: "Parcela a vencer", quoteId: 3, receivableId: 7, clientName: "Maria", phone: "5511999990000", email: "", subject: "Parcela", body: "Olá", amount: 150, pix: "00020126PIX" } as DialogMessage;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.mutate.mockReset();
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(navigator, "share");
});

describe("PIX da parcela na cobrança", () => {
  it("no computador, baixa o QR Code para anexar na conversa", async () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    render(<MessageDialog open message={message} onOpenChange={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Baixar QR Code" }));
    });
    expect(downloads).toEqual(["pix-parcela-7.png"]);
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ receivableId: 7, channel: "copy" }));
  });

  it("no celular, envia a imagem pela tela de compartilhar", async () => {
    const share = vi.fn(async () => undefined);
    Object.assign(navigator, { canShare: () => true, share });
    render(<MessageDialog open message={message} onOpenChange={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar QR Code" }));
    });
    const sent = share.mock.calls[0] as unknown as [{ files: File[] }];
    expect(sent[0].files[0]).toMatchObject({ name: "pix-parcela-7.png", type: "image/png" });
  });

  it("explica quando a cobrança vai sem PIX", () => {
    render(<MessageDialog open message={{ ...message, pix: "" }} onOpenChange={() => undefined} />);
    expect(screen.getByText(/vai sem PIX/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /QR Code/ })).toBeNull();
  });
});
