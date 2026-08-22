export type StockMovementType = "entry" | "delivery" | "adjustment" | "return";

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function getStockDelta(type: StockMovementType, quantity: number) {
  if (type === "delivery") return -Math.abs(quantity);
  if (type === "entry" || type === "return") return Math.abs(quantity);
  return quantity;
}

export function calculateStockAfter(before: number, type: StockMovementType, quantity: number) {
  const after = round(before + getStockDelta(type, quantity));
  if (after < 0) throw new Error("Saldo insuficiente para esta saída de estoque");
  return after;
}

export function calculatePendingDelivery(orderedQuantity: number, deliveredQuantities: number[]) {
  const delivered = round(deliveredQuantities.reduce((sum, quantity) => sum + quantity, 0));
  return { delivered, pending: Math.max(0, round(orderedQuantity - delivered)) };
}

export function calculateAvailableStock(stockQuantity: number, reservedQuantity: number) {
  return round(stockQuantity - reservedQuantity);
}

export function assertReservableQuantity(stockQuantity: number, reservedQuantity: number, requestedQuantity: number) {
  const availableQuantity = calculateAvailableStock(stockQuantity, reservedQuantity);
  if (requestedQuantity > availableQuantity) throw new Error(`Estoque disponível insuficiente: solicitado ${requestedQuantity}, disponível ${Math.max(0, availableQuantity)}`);
  return availableQuantity;
}

export function calculateRemainingReservation(reservedQuantity: number, deliveredQuantity: number) {
  if (deliveredQuantity > reservedQuantity) throw new Error("A entrega excede a quantidade reservada");
  return round(reservedQuantity - deliveredQuantity);
}
