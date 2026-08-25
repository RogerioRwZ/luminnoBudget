// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePrintDocument, waitForPrintImages } from "./printPreparation";

function appendPendingPrintImage() {
  const documentRoot = document.createElement("article");
  documentRoot.className = "print-document";
  const image = document.createElement("img");
  Object.defineProperty(image, "complete", { configurable: true, get: () => false });
  documentRoot.append(image);
  document.body.append(documentRoot);
  return { documentRoot, image };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("preparação de impressão", () => {
  it("aguarda imagens pendentes e continua quando elas carregam", async () => {
    const { documentRoot, image } = appendPendingPrintImage();
    const waiting = waitForPrintImages(documentRoot);

    image.dispatchEvent(new Event("load"));

    await expect(waiting).resolves.toBeUndefined();
  });

  it("continua quando uma imagem falha ou excede o tempo seguro", async () => {
    const failed = appendPendingPrintImage();
    const failedWaiting = waitForPrintImages(failed.documentRoot);
    failed.image.dispatchEvent(new Event("error"));
    await expect(failedWaiting).resolves.toBeUndefined();

    vi.useFakeTimers();
    const timedOut = appendPendingPrintImage();
    const timedOutWaiting = waitForPrintImages(timedOut.documentRoot, 20);
    await vi.advanceTimersByTimeAsync(20);
    await expect(timedOutWaiting).resolves.toBeUndefined();
  });

  it("aguarda duas animações antes de consultar as imagens", async () => {
    const callbackQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbackQueue.push(callback);
      return callbackQueue.length;
    });

    const ready = preparePrintDocument(document);
    expect(callbackQueue).toHaveLength(1);
    callbackQueue.shift()!(0);
    expect(callbackQueue).toHaveLength(1);
    callbackQueue.shift()!(16);

    await expect(ready).resolves.toBeUndefined();
  });
});
