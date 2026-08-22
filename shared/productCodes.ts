export function nextProductCode(codes: Array<string | null | undefined>) {
  const highest = codes.reduce((current, code) => {
    const value = Number(code);
    return Number.isInteger(value) && value > current ? value : current;
  }, 0);
  return String(highest + 1);
}
