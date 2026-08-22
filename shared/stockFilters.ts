export type InventoryFilterProduct = { supplierName: string | null; stockQuantity: number; reservedQuantity: number; lowStock: boolean };
export type InventoryFilters = { supplier: string; maximumStock: string; availability: "all" | "reserved" | "low" };

export function filterInventoryProducts<T extends InventoryFilterProduct>(products: T[], filters: InventoryFilters) {
  const maximumStock = filters.maximumStock.trim() === "" ? null : Number(filters.maximumStock);
  return products.filter((product) => {
    if (filters.supplier !== "all" && product.supplierName !== filters.supplier) return false;
    if (maximumStock !== null && product.stockQuantity > maximumStock) return false;
    if (filters.availability === "reserved" && product.reservedQuantity <= 0) return false;
    if (filters.availability === "low" && !product.lowStock) return false;
    return true;
  });
}
