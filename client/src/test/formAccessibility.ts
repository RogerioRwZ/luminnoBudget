import { expect } from "vitest";

export function expectNoUnnamedFormControls(container: HTMLElement) {
  const unnamed = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")).filter(control => {
    if (control.type === "hidden") return false;
    if (control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) return false;
    if (control.id && container.querySelector(`label[for="${CSS.escape(control.id)}"]`)) return false;
    return !control.closest("label");
  });

  expect(unnamed.map(control => control.outerHTML)).toEqual([]);
}
