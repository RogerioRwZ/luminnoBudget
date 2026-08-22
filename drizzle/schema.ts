import {
  boolean,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 80 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  isActive: boolean("isActive").notNull().default(true),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 240 }).notNull(),
  professional: varchar("professional", { length: 240 }).notNull(),
  document: varchar("document", { length: 32 }),
  stateRegistration: varchar("stateRegistration", { length: 32 }),
  phone: varchar("phone", { length: 40 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  shortDescription: varchar("shortDescription", { length: 512 }).notNull(),
  fullDescription: text("fullDescription"),
  imageUrl: text("imageUrl"),
  imageKey: varchar("imageKey", { length: 768 }),
  unit: varchar("unit", { length: 16 }).notNull().default("UN"),
  supplierName: varchar("supplierName", { length: 240 }),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull().default("0"),
  stockQuantity: decimal("stockQuantity", { precision: 12, scale: 2 }).notNull().default("0"),
  reorderPoint: decimal("reorderPoint", { precision: 12, scale: 2 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const quotes = mysqlTable("quotes", {
  id: int("id").autoincrement().primaryKey(),
  quoteNumber: int("quoteNumber").notNull().unique(),
  clientId: int("clientId"),
  clientName: varchar("clientName", { length: 240 }).notNull(),
  professional: varchar("professional", { length: 240 }).notNull(),
  document: varchar("document", { length: 32 }),
  stateRegistration: varchar("stateRegistration", { length: 32 }),
  phone: varchar("phone", { length: 40 }),
  address: text("address"),
  status: mysqlEnum("status", ["draft", "open", "approved", "lost"]).notNull().default("draft"),
  issueDate: timestamp("issueDate").notNull().defaultNow(),
  validUntil: timestamp("validUntil"),
  discountMode: mysqlEnum("discountMode", ["percentage", "fixed"]).notNull().default("percentage"),
  discountValue: decimal("discountValue", { precision: 12, scale: 2 }).notNull().default("0"),
  shipping: decimal("shipping", { precision: 12, scale: 2 }).notNull().default("0"),
  pixDiscountMode: mysqlEnum("pixDiscountMode", ["percentage", "fixed"]).notNull().default("percentage"),
  pixDiscountValue: decimal("pixDiscountValue", { precision: 12, scale: 2 }).notNull().default("0"),
  installments: int("installments").notNull().default(8),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const quoteRooms = mysqlTable("quoteRooms", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
});

export const quoteItems = mysqlTable("quoteItems", {
  id: int("id").autoincrement().primaryKey(),
  quoteRoomId: int("quoteRoomId").notNull(),
  productId: int("productId"),
  code: varchar("code", { length: 64 }).notNull(),
  shortDescription: varchar("shortDescription", { length: 512 }).notNull(),
  imageUrl: text("imageUrl"),
  unit: varchar("unit", { length: 16 }).notNull().default("UN"),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull().default("0"),
  sortOrder: int("sortOrder").notNull().default(0),
});

export const quoteItemReservations = mysqlTable("quoteItemReservations", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  quoteItemId: int("quoteItemId").notNull().unique(),
  productId: int("productId").notNull(),
  reservedQuantity: decimal("reservedQuantity", { precision: 12, scale: 2 }).notNull(),
  reservedAt: timestamp("reservedAt").notNull().defaultNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const stockMovements = mysqlTable("stockMovements", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  type: mysqlEnum("type", ["entry", "delivery", "adjustment", "return"]).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  beforeQuantity: decimal("beforeQuantity", { precision: 12, scale: 2 }).notNull(),
  afterQuantity: decimal("afterQuantity", { precision: 12, scale: 2 }).notNull(),
  quoteId: int("quoteId"),
  quoteItemId: int("quoteItemId"),
  clientName: varchar("clientName", { length: 240 }),
  responsible: varchar("responsible", { length: 240 }),
  notes: text("notes"),
  occurredAt: timestamp("occurredAt").notNull().defaultNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const quoteItemDeliveries = mysqlTable("quoteItemDeliveries", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  quoteItemId: int("quoteItemId").notNull(),
  productId: int("productId").notNull(),
  clientName: varchar("clientName", { length: 240 }),
  deliveredQuantity: decimal("deliveredQuantity", { precision: 12, scale: 2 }).notNull(),
  deliveredAt: timestamp("deliveredAt").notNull().defaultNow(),
  responsible: varchar("responsible", { length: 240 }),
  notes: text("notes"),
  stockMovementId: int("stockMovementId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const storeSettings = mysqlTable("storeSettings", {
  id: int("id").primaryKey(),
  companyName: varchar("companyName", { length: 256 }).notNull().default("Luminno Iluminação"),
  tradingName: varchar("tradingName", { length: 256 }).notNull().default("Luminno"),
  logoUrl: text("logoUrl"),
  document: varchar("document", { length: 32 }),
  address: text("address"),
  phone: varchar("phone", { length: 40 }),
  email: varchar("email", { length: 320 }),
  pixKey: varchar("pixKey", { length: 320 }),
  pixRecipient: varchar("pixRecipient", { length: 256 }),
  defaultPixDiscountMode: mysqlEnum("defaultPixDiscountMode", ["percentage", "fixed"]).notNull().default("percentage"),
  defaultPixDiscountValue: decimal("defaultPixDiscountValue", { precision: 12, scale: 2 }).notNull().default("0"),
  defaultInstallments: int("defaultInstallments").notNull().default(8),
  alertThresholdDays: int("alertThresholdDays").notNull().default(7),
  defaultTerms: text("defaultTerms"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
