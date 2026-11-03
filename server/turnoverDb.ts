import { and, eq, max, min } from "drizzle-orm";
import { products, quoteItems, quoteRooms, quotes, stockMovements } from "../drizzle/schema";
import { toNumber } from "../shared/quote";
import { abcCurve, staleStock } from "../shared/stockTurnover";
import { getDb } from "./db";
import { salesReport } from "./reportsDb";
import { modelProductIds } from "../shared/variants";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

// Produtos com saldo que não vendem há `days` dias.
export async function staleStockReport(days: number, now = new Date()) {
  const db = await database();
  const [productRows, lastSales, firstEntries] = await Promise.all([
    db.select().from(products).where(eq(products.active, true)),
    db
      .select({ productId: quoteItems.productId, lastSaleAt: max(quotes.approvedAt) })
      .from(quoteItems)
      .innerJoin(quoteRooms, eq(quoteItems.quoteRoomId, quoteRooms.id))
      .innerJoin(quotes, eq(quoteRooms.quoteId, quotes.id))
      .where(eq(quotes.status, "approved"))
      .groupBy(quoteItems.productId),
    db.select({ productId: stockMovements.productId, firstAt: min(stockMovements.occurredAt) }).from(stockMovements).where(and(eq(stockMovements.type, "entry"))).groupBy(stockMovements.productId),
  ]);
  const lastSale = new Map(lastSales.flatMap((row) => (row.productId && row.lastSaleAt ? [[row.productId, new Date(row.lastSaleAt)] as const] : [])));
  const firstEntry = new Map(firstEntries.flatMap((row) => (row.firstAt ? [[row.productId, new Date(row.firstAt)] as const] : [])));
  // O modelo de um produto com variações não tem estoque próprio.
  const models = modelProductIds(productRows);
  return staleStock(productRows.filter((product) => !models.has(product.id)).map((product) => ({
    productId: product.id,
    code: product.code,
    description: product.shortDescription,
    supplierName: product.supplierName,
    unit: product.unit,
    stock: toNumber(product.stockQuantity),
    unitCost: product.costPrice === null ? null : toNumber(product.costPrice),
    lastSaleAt: lastSale.get(product.id) ?? null,
    firstStockAt: firstEntry.get(product.id) ?? product.createdAt,
  })), days, now);
}

// Curva ABC dos produtos do catálogo vendidos no período, pelo valor vendido
// (já com o desconto do orçamento, sem frete), com o saldo atual ao lado.
export async function abcReport(range: { from: Date; to: Date }) {
  const db = await database();
  const [report, productRows] = await Promise.all([
    salesReport(range),
    db.select({ id: products.id, stockQuantity: products.stockQuantity, reorderPoint: products.reorderPoint, supplierName: products.supplierName, unit: products.unit }).from(products),
  ]);
  const byId = new Map(productRows.map((row) => [row.id, row]));
  const rows = report.byProduct.flatMap((row) => {
    const productId = Number(row.key.replace("product-", ""));
    const product = row.key.startsWith("product-") ? byId.get(productId) : undefined;
    if (!product) return [];
    return [{
      productId,
      label: row.label,
      supplierName: product.supplierName,
      unit: product.unit,
      quantity: row.quantity,
      revenue: row.revenue,
      quotes: row.quotes,
      stock: toNumber(product.stockQuantity),
      reorderPoint: toNumber(product.reorderPoint),
    }];
  });
  return abcCurve(rows);
}
