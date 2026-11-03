import {
  boolean,
  decimal,
  index,
  int,
  mediumtext,
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
  role: mysqlEnum("role", ["user", "admin", "sales", "stock", "finance"]).default("user").notNull(),
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
  // Referência do produto (letras, números e símbolos), única. Obrigatória no
  // cadastro; nula só em backups antigos, que recebem o código ao restaurar.
  reference: varchar("reference", { length: 64 }).unique(),
  shortDescription: varchar("shortDescription", { length: 512 }).notNull(),
  fullDescription: text("fullDescription"),
  imageUrl: text("imageUrl"),
  imageKey: varchar("imageKey", { length: 768 }),
  barcode: varchar("barcode", { length: 64 }).unique(),
  unit: varchar("unit", { length: 16 }).notNull().default("UN"),
  supplierName: varchar("supplierName", { length: 240 }),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull().default("0"),
  // Preço de custo: nunca aparece para o perfil Vendas.
  costPrice: decimal("costPrice", { precision: 12, scale: 2 }),
  stockQuantity: decimal("stockQuantity", { precision: 12, scale: 2 }).notNull().default("0"),
  reorderPoint: decimal("reorderPoint", { precision: 12, scale: 2 }).notNull().default("0"),
  // Garantia em meses; nulo usa a garantia padrão das Configurações.
  warrantyMonths: int("warrantyMonths"),
  active: boolean("active").notNull().default(true),
  // Variações (cor, temperatura de cor, potência...): cada variação é um
  // produto completo ligado ao produto principal do modelo (parentId).
  parentId: int("parentId"),
  modelName: varchar("modelName", { length: 512 }),
  attributes: text("attributes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("products_parentId_idx").on(table.parentId)]);

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
  // Forma de pagamento da venda (JSON, ver shared/paymentPlan), escolhida na
  // aprovação. Nulo nos orçamentos aprovados antes desta versão.
  paymentPlan: text("paymentPlan"),
  // Condição "entrada + crediário" oferecida na proposta (JSON; nulo = não oferece).
  entryOffer: text("entryOffer"),
  notes: text("notes"),
  // Ordem de chegada dos aprovados: o estoque que entra atende primeiro quem
  // foi aprovado antes.
  approvedAt: timestamp("approvedAt"),
  // Acompanhamento das propostas em negociação.
  followUpAt: timestamp("followUpAt"),
  lostReason: mysqlEnum("lostReason", ["price", "deadline", "competitor", "postponed", "product", "no_response", "other"]),
  lostNotes: varchar("lostNotes", { length: 500 }),
  // Quem criou o orçamento (relatório de vendas por vendedor).
  sellerUserId: int("sellerUserId"),
  // Percentual de comissão do profissional fixado na aprovação.
  commissionPercent: decimal("commissionPercent", { precision: 5, scale: 2 }),
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
  // Custo do produto no momento em que o item foi gravado: a margem de uma
  // venda não muda quando o custo do catálogo é reajustado depois.
  unitCost: decimal("unitCost", { precision: 12, scale: 2 }),
  sortOrder: int("sortOrder").notNull().default(0),
});

export const quotePdfHistory = mysqlTable("quotePdfHistory", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  createdByUserId: int("createdByUserId").notNull(),
  fileName: varchar("fileName", { length: 180 }).notNull(),
  // Arquivo gravado no disco: só nos PDFs gerados antes desta versão.
  storageKey: varchar("storageKey", { length: 255 }).unique(),
  // Dados usados no PDF (JSON). O documento é montado de novo no navegador
  // ao baixar, sem guardar o arquivo no servidor.
  snapshot: mediumtext("snapshot"),
  fileSize: int("fileSize").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const financeReceivables = mysqlTable("financeReceivables", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId"),
  clientId: int("clientId"),
  clientName: varchar("clientName", { length: 240 }).notNull(),
  description: varchar("description", { length: 512 }).notNull(),
  installmentNumber: int("installmentNumber").notNull().default(1),
  installmentCount: int("installmentCount").notNull().default(1),
  // Forma prevista (boleto, crediário...): vem preenchida ao receber.
  paymentMethod: mysqlEnum("paymentMethod", ["pix", "cash", "credit_card", "debit_card", "bank_transfer", "boleto", "store_credit", "other"]),
  originalAmount: decimal("originalAmount", { precision: 12, scale: 2 }).notNull(),
  dueDate: timestamp("dueDate").notNull(),
  status: mysqlEnum("status", ["open", "partial", "paid", "cancelled"]).notNull().default("open"),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const financePayments = mysqlTable("financePayments", {
  id: int("id").autoincrement().primaryKey(),
  receivableId: int("receivableId").notNull(),
  type: mysqlEnum("type", ["receipt", "reversal"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["pix", "cash", "credit_card", "debit_card", "bank_transfer", "boleto", "store_credit", "other"]).notNull().default("other"),
  // Taxa da maquininha descontada deste recebimento (cartão).
  feeAmount: decimal("feeAmount", { precision: 12, scale: 2 }),
  paidAt: timestamp("paidAt").notNull().defaultNow(),
  reference: varchar("reference", { length: 120 }),
  notes: text("notes"),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  // loan_out/loan_return: saída e volta de peças emprestadas (mostruário).
  type: mysqlEnum("type", ["entry", "delivery", "adjustment", "return", "loan_out", "loan_return"]).notNull(),
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
  // Nulo para itens avulsos (sem produto de estoque): a retirada é
  // registrada, mas não movimenta estoque.
  productId: int("productId"),
  clientName: varchar("clientName", { length: 240 }),
  deliveredQuantity: decimal("deliveredQuantity", { precision: 12, scale: 2 }).notNull(),
  deliveredAt: timestamp("deliveredAt").notNull().defaultNow(),
  responsible: varchar("responsible", { length: 240 }),
  notes: text("notes"),
  stockMovementId: int("stockMovementId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const quoteVersions = mysqlTable("quoteVersions", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  versionNumber: int("versionNumber").notNull(),
  snapshot: text("snapshot").notNull(),
  changeNote: varchar("changeNote", { length: 512 }),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const internalComments = mysqlTable("internalComments", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  body: text("body").notNull(),
  authorUserId: int("authorUserId").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const quoteAttachments = mysqlTable("quoteAttachments", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  fileName: varchar("fileName", { length: 180 }).notNull(),
  storageKey: varchar("storageKey", { length: 255 }).notNull().unique(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  fileSize: int("fileSize").notNull(),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const messageTemplates = mysqlTable("messageTemplates", {
  id: int("id").autoincrement().primaryKey(),
  event: mysqlEnum("event", ["quote_sent", "quote_approved", "quote_expiring", "quote_expired", "payment_due", "payment_overdue", "delivery_scheduled", "delivery_completed"]).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  subject: varchar("subject", { length: 240 }),
  body: text("body").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  pixCity: varchar("pixCity", { length: 60 }),
  defaultPixDiscountMode: mysqlEnum("defaultPixDiscountMode", ["percentage", "fixed"]).notNull().default("percentage"),
  defaultPixDiscountValue: decimal("defaultPixDiscountValue", { precision: 12, scale: 2 }).notNull().default("0"),
  defaultInstallments: int("defaultInstallments").notNull().default(8),
  followUpDays: int("followUpDays").notNull().default(3),
  // Desconto acima deste percentual gera aviso no orçamento (0 = sem limite).
  maxDiscountPercent: decimal("maxDiscountPercent", { precision: 5, scale: 2 }).notNull().default("0"),
  // Margem abaixo deste percentual gera aviso (0 = sem aviso).
  minMarginPercent: decimal("minMarginPercent", { precision: 5, scale: 2 }).notNull().default("0"),
  defaultCommissionPercent: decimal("defaultCommissionPercent", { precision: 5, scale: 2 }).notNull().default("0"),
  alertThresholdDays: int("alertThresholdDays").notNull().default(7),
  defaultWarrantyMonths: int("defaultWarrantyMonths").notNull().default(12),
  // Taxas da maquininha (JSON: débito e crédito de 1x a 12x, em %).
  cardFees: text("cardFees"),
  defaultTerms: text("defaultTerms"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Agenda de entregas, visitas técnicas e instalações.
export const appointments = mysqlTable("appointments", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["delivery", "technical_visit", "installation"]).notNull(),
  status: mysqlEnum("status", ["scheduled", "done", "cancelled"]).notNull().default("scheduled"),
  quoteId: int("quoteId"),
  clientId: int("clientId"),
  clientName: varchar("clientName", { length: 240 }).notNull(),
  phone: varchar("phone", { length: 40 }),
  address: text("address"),
  scheduledAt: timestamp("scheduledAt").notNull(),
  durationMinutes: int("durationMinutes").notNull().default(60),
  responsible: varchar("responsible", { length: 240 }),
  notes: text("notes"),
  createdByUserId: int("createdByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("appointments_scheduledAt_idx").on(table.scheduledAt)]);

// Comissão dos profissionais (arquitetos, designers). O nome é o mesmo
// texto usado nos orçamentos; sem cadastro, vale a comissão padrão da loja.
export const professionals = mysqlTable("professionals", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 240 }).notNull().unique(),
  commissionPercent: decimal("commissionPercent", { precision: 5, scale: 2 }),
  phone: varchar("phone", { length: 40 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const commissionPayments = mysqlTable("commissionPayments", {
  id: int("id").autoincrement().primaryKey(),
  professional: varchar("professional", { length: 240 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paidAt: timestamp("paidAt").notNull(),
  notes: varchar("notes", { length: 500 }),
  createdByUserId: int("createdByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("commissionPayments_professional_idx").on(table.professional)]);

// Pós-venda: trocas, devoluções e garantias de um item vendido. Cliente,
// produto e fornecedor são copiados na abertura para o histórico não mudar
// quando o orçamento ou o catálogo forem editados depois.
export const afterSalesCases = mysqlTable("afterSalesCases", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  quoteItemId: int("quoteItemId").notNull(),
  productId: int("productId"),
  clientName: varchar("clientName", { length: 240 }).notNull(),
  productDescription: varchar("productDescription", { length: 512 }).notNull(),
  supplierName: varchar("supplierName", { length: 240 }),
  type: mysqlEnum("type", ["return", "exchange", "warranty"]).notNull(),
  reason: mysqlEnum("reason", ["defect", "damaged", "wrong_product", "regret", "installation", "other"]).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["open", "supplier", "resolved", "rejected"]).notNull().default("open"),
  description: text("description"),
  resolution: text("resolution"),
  refundAmount: decimal("refundAmount", { precision: 12, scale: 2 }),
  // Movimentações geradas ao resolver: peça devolvida ao estoque e peça
  // nova entregue na troca. Gravadas para não repetir a baixa.
  restockMovementId: int("restockMovementId"),
  replacementMovementId: int("replacementMovementId"),
  openedAt: timestamp("openedAt").notNull().defaultNow(),
  dueDate: timestamp("dueDate").notNull(),
  resolvedAt: timestamp("resolvedAt"),
  createdByUserId: int("createdByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("afterSalesCases_quoteId_idx").on(table.quoteId),
  index("afterSalesCases_status_idx").on(table.status),
]);

// Mostruário e consignação: peças emprestadas a clientes e profissionais
// para testar na obra. Saem do estoque sem virar venda e, no acerto, voltam,
// viram venda (voltam ao saldo para o pedido) ou são dadas como perdidas.
export const stockLoans = mysqlTable("stockLoans", {
  id: int("id").autoincrement().primaryKey(),
  borrowerName: varchar("borrowerName", { length: 240 }).notNull(),
  borrowerKind: mysqlEnum("borrowerKind", ["client", "professional", "other"]).notNull().default("client"),
  phone: varchar("phone", { length: 40 }),
  quoteId: int("quoteId"),
  notes: text("notes"),
  loanedAt: timestamp("loanedAt").notNull().defaultNow(),
  dueDate: timestamp("dueDate").notNull(),
  closedAt: timestamp("closedAt"),
  createdByUserId: int("createdByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("stockLoans_dueDate_idx").on(table.dueDate)]);

export const stockLoanItems = mysqlTable("stockLoanItems", {
  id: int("id").autoincrement().primaryKey(),
  loanId: int("loanId").notNull(),
  productId: int("productId").notNull(),
  shortDescription: varchar("shortDescription", { length: 512 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  returnedQuantity: decimal("returnedQuantity", { precision: 12, scale: 2 }).notNull().default("0"),
  soldQuantity: decimal("soldQuantity", { precision: 12, scale: 2 }).notNull().default("0"),
  lostQuantity: decimal("lostQuantity", { precision: 12, scale: 2 }).notNull().default("0"),
}, (table) => [index("stockLoanItems_loanId_idx").on(table.loanId)]);

// Avisos no celular (Web Push): um registro por aparelho que ativou os
// avisos. O endereço é longo demais para índice único; o hash cumpre o papel.
export const pushSubscriptions = mysqlTable("pushSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  endpointHash: varchar("endpointHash", { length: 64 }).notNull().unique(),
  endpoint: text("endpoint").notNull(),
  p256dh: varchar("p256dh", { length: 160 }).notNull(),
  auth: varchar("auth", { length: 64 }).notNull(),
  userAgent: varchar("userAgent", { length: 255 }),
  lastDailyAt: timestamp("lastDailyAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("pushSubscriptions_userId_idx").on(table.userId)]);

// Chaves e marcadores internos do sistema (ex.: chaves VAPID dos avisos).
export const appKeys = mysqlTable("appKeys", {
  name: varchar("name", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Registro de atividades: quem fez o quê e quando. O nome do usuário é
// copiado no momento da ação para o histórico continuar legível mesmo se o
// usuário for renomeado ou desativado.
export const activityLog = mysqlTable("activityLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userName: varchar("userName", { length: 240 }),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entityType", { length: 32 }).notNull(),
  entityId: int("entityId"),
  summary: varchar("summary", { length: 512 }).notNull(),
  details: text("details"),
  ip: varchar("ip", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("activityLog_createdAt_idx").on(table.createdAt),
  index("activityLog_entity_idx").on(table.entityType, table.entityId),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
