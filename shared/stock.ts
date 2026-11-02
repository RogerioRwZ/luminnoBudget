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

// O banco guarda quantidades com 2 casas; 0,005 seria arredondado num lugar
// e não no outro, deixando estoque e reservas descasados.
export function isCentQuantity(value: number) {
  return Number.isFinite(value) && Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

// Situação de um item de orçamento aprovado. Itens avulsos (sem produto)
// não têm estoque: tudo o que falta pode ser retirado.
export function describeFulfillment(input: { ordered: number; delivered: number; reserved: number; stock: number | null }) {
  const pending = Math.max(0, round(input.ordered - input.delivered));
  if (input.stock === null) return { pending, deliverable: pending, shortage: 0 };
  return {
    pending,
    deliverable: Math.max(0, round(Math.min(pending, input.reserved, input.stock))),
    shortage: Math.max(0, round(pending - input.reserved)),
  };
}
