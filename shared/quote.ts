export type DiscountMode = "percentage" | "fixed";

export type PricingItem = {
  quantity: number;
  unitPrice: number;
};

export type PricingRoom = {
  items: PricingItem[];
};

export type PricingInput = {
  rooms: PricingRoom[];
  discountMode: DiscountMode;
  discountValue: number;
  shipping: number;
  pixDiscountMode: DiscountMode;
  pixDiscountValue: number;
  installments: number;
};

export type PricingSummary = {
  rooms: number[];
  productsSubtotal: number;
  discountAmount: number;
  shipping: number;
  total: number;
  pixDiscountAmount: number;
  pixTotal: number;
  installmentValue: number;
};

export const roundMoney = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

export const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

export function calculateDiscount(
  base: number,
  mode: DiscountMode,
  value: number,
) {
  const normalizedBase = Math.max(0, base);
  const normalizedValue = Math.max(0, value || 0);
  const raw = mode === "percentage"
    ? normalizedBase * (normalizedValue / 100)
    : normalizedValue;
  return roundMoney(Math.min(normalizedBase, raw));
}

export function calculateQuote(input: PricingInput): PricingSummary {
  const rooms = input.rooms.map((room) =>
    roundMoney(room.items.reduce(
      (sum, item) => sum + Math.max(0, item.quantity || 0) * Math.max(0, item.unitPrice || 0),
      0,
    ))
  );
  const productsSubtotal = roundMoney(rooms.reduce((sum, value) => sum + value, 0));
  const discountAmount = calculateDiscount(
    productsSubtotal,
    input.discountMode,
    input.discountValue,
  );
  const shipping = roundMoney(Math.max(0, input.shipping || 0));
  const total = roundMoney(productsSubtotal - discountAmount + shipping);
  const pixDiscountAmount = calculateDiscount(
    total,
    input.pixDiscountMode,
    input.pixDiscountValue,
  );
  const pixTotal = roundMoney(total - pixDiscountAmount);
  const installments = Math.max(1, Math.floor(input.installments || 1));

  return {
    rooms,
    productsSubtotal,
    discountAmount,
    shipping,
    total,
    pixDiscountAmount,
    pixTotal,
    installmentValue: roundMoney(total / installments),
  };
}
