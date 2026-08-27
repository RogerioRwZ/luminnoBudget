export function waitForTwoAnimationFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function waitForPrintImages(root: ParentNode = document, timeoutMs = 5000): Promise<void> {
  const pendingImages = Array.from(root.querySelectorAll<HTMLImageElement>(".print-document img"))
    .filter((image) => !image.complete);

  return Promise.all(pendingImages.map((image) => new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, timeoutMs);
    function finish() {
      window.clearTimeout(timeout);
      resolve();
    }
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  }))).then(() => undefined);
}

export async function preparePrintDocument(root: ParentNode = document): Promise<void> {
  await waitForTwoAnimationFrames();
  await waitForPrintImages(root);
}
