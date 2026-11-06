import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { saveLocalAttachment, saveLocalImage } from "../localStorage";
import { addAttachment, addComment, createQuoteVersion, findProductByBarcode, listAttachments, listComments, listMessageTemplates, listQuoteVersions, resolveComment, restoreQuoteVersion, saveMessageTemplate, updateProductBarcode } from "../advancedDb";
import {
  createQuote,
  createQuotePdfHistory,
  getQuotePdfSnapshot,
  customerStatement,
  dashboardMetrics,
  deleteProduct,
  deleteQuote,
  exportBackup,
  getQuote,
  getSettings,
  getPickingList,
  quoteOptions,
  quoteLockInfo,
  registerFollowUp,
  getProduct,
  importBackup,
  listClients,
  listProducts,
  listQuotes,
  listAllQuotePdfHistory,
  listQuotePdfHistory,
  listQuotesPaged,
  saveClient,
  saveProduct,
  saveQuote,
  productCosts,
  saveSettings,
} from "../quoteDb";
import { approvedFulfillments, cancelRemainder, productAvailability, deliverAllAvailable, deliverQuoteItem, deliverQuoteItems, fulfillmentLines, inventoryOverview, purchaseSuggestions, recordStockMovement, reverseDelivery, undoCancellation } from "../stockDb";
import { ensureSupplier, listSuppliers, renameSupplier } from "../suppliersDb";
import { importProductRow, isDuplicateEntry, type ImportResult } from "../productImportDb";
import { isCentQuantity } from "../../shared/stock";
import { barcodeProblem, normalizeBarcode } from "../../shared/productCodes";
import { quoteMargin } from "../../shared/margin";
import { cleanUnit, isNumericUnit, NUMERIC_UNIT_MESSAGE } from "../../shared/units";
import { canAccess, canSeeCost, USER_ROLES } from "../../shared/permissions";
import { abcReport, staleStockReport } from "../turnoverDb";
import { commissionReport, dailySummary, deleteCommissionPayment, recordCommissionPayment, salesReport, saveProfessional } from "../reportsDb";
import { withoutCost } from "../../shared/salesReport";
import { LOST_REASONS, LOST_REASON_LABELS } from "../../shared/followUp";
import { deleteAppointment, findConflicts, listAppointments, saveAppointment, setAppointmentStatus, upcomingAppointments } from "../agendaDb";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from "../../shared/agenda";
import { cancelReceivable, createReceivables, financeByQuote, financeClients, financeOverview, getReceivableSummary, legacyApprovedQuotes, recordFinancePayment, settleLegacyQuote } from "../financeDb";
import { changedFields, formatActivityMoney as brl, listActivity, recordActivity, type ActivityEntity, type ActivityEntry } from "../activityLog";
import { messageForQuote, messageForReceivable, pendingMessages } from "../messagesDb";
import { MESSAGE_EVENT_LABELS } from "../../shared/messages";
import { adminProcedure, areaProcedure, protectedProcedure, router } from "../_core/trpc";
import { plural } from "../../shared/plural";
import { quotePdfFileName, sanitizePdfSnapshot } from "../../shared/quoteFileName";
import { MAX_PLAN_INSTALLMENTS, MAX_PLAN_PARTS, parseEntryOffer, PLAN_METHODS } from "../../shared/paymentPlan";
import { documentField, emailField, phoneField } from "./contactFields";
import { normalizeStoredContacts } from "../contactMigration";

const nullableText = z.string().trim().max(2000).nullable().optional();

type ActivityCtx = { user: { id: number; name: string | null; username: string | null }; req: { ip?: string; socket?: { remoteAddress?: string } } };
const log = (ctx: ActivityCtx, entry: ActivityEntry) => recordActivity(ctx.user, entry, ctx.req);
const STATUS_LABELS = { draft: "rascunho", open: "em aberto", approved: "aprovado", lost: "não aprovado" } as const;
const messageEvent = z.enum(["quote_sent", "quote_approved", "quote_expiring", "quote_expired", "payment_due", "payment_overdue", "delivery_scheduled", "delivery_completed"]);

const money = z.coerce.number().min(0).max(99_999_999).default(0);
const imageLocation = z.string().trim().max(2000).refine(
  (value) => value.startsWith("/uploads/") && !value.includes(".."),
  "Envie uma imagem local válida",
);

// Itens antigos podem guardar a foto em outro armazenamento; aceita caminho
// local ou HTTPS, mas nunca esquemas como javascript:, data: ou http:.
const itemImageLocation = z.string().trim().max(2000).refine(
  (value) => (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) || /^https:\/\/[^\s]+$/i.test(value),
  "Imagem do item inválida",
);

const clientInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Informe o nome do cliente").max(240),
  professional: z.string().trim().max(240).default(""),
  document: documentField(true),
  stateRegistration: nullableText,
  phone: phoneField(true),
  email: emailField(),
  address: nullableText,
});

const deliveryQuantity = z.coerce.number().positive().max(99_999).refine(isCentQuantity, "Use no máximo 2 casas decimais na quantidade");
const correctionReason = z.string().trim().min(3, "Informe o motivo").max(500);
// Folga de um minuto para diferença de relógio entre o aparelho e o servidor.
const deliveredAt = z.coerce.date().refine((date) => date.getTime() <= Date.now() + 60_000, "A data da retirada não pode estar no futuro.");
const deliveryMeta = { responsible: nullableText, notes: nullableText, deliveredAt };

async function logDelivery(ctx: Parameters<typeof log>[0], quoteId: number, results: Array<{ quoteItemId: number }>, responsible?: string | null) {
  const [quote, lines] = await Promise.all([getQuote(quoteId), fulfillmentLines([quoteId])]);
  const complete = lines.every((line) => line.pendingQuantity <= 0);
  await log(ctx, { action: "stock.delivery", entityType: "stock", entityId: quoteId, summary: `Registrou retirada de ${plural(results.length, "item", "itens")} do orçamento #${quote?.quoteNumber ?? quoteId}${quote?.clientName ? ` (${quote.clientName})` : ""}${complete ? " — pedido totalmente entregue" : ""}`, details: { responsavel: responsible ?? null } });
}

// Desconto máximo e margem mínima: acima do limite, Vendas prepara a proposta,
// mas quem aprova é outro perfil. Zero nas Configurações desliga a regra.
function saleLimitProblem(input: { discountMode: "percentage" | "fixed"; discountValue: number; rooms: Array<{ items: Array<{ productId?: number | null; quantity: number; unitPrice: number }> }> }, settings: { maxDiscountPercent: string | number; minMarginPercent: string | number }, costs: Map<number, number | null>) {
  const items = input.rooms.flatMap((room) => room.items);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountAmount = input.discountMode === "percentage" ? (subtotal * input.discountValue) / 100 : input.discountValue;
  const discount = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
  const maxDiscount = Number(settings.maxDiscountPercent);
  if (maxDiscount > 0 && discount > maxDiscount + 0.001) return `Desconto de ${discount.toFixed(1).replace(".", ",")}% passa do limite de ${maxDiscount}%. Peça a outro perfil para aprovar este orçamento.`;
  const minMargin = Number(settings.minMarginPercent);
  const margin = quoteMargin(items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice, unitCost: item.productId ? costs.get(item.productId) ?? null : null })), discountAmount).margin;
  if (minMargin > 0 && margin !== null && margin * 100 < minMargin) return `Este orçamento está abaixo da margem mínima de ${minMargin}%. Peça a outro perfil para aprová-lo.`;
  return null;
}

const periodInput = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((range) => range.to > range.from && range.to.getTime() - range.from.getTime() <= 367 * 24 * 60 * 60_000, "Escolha um período de até um ano.");

const appointmentInput = z.object({
  id: z.number().int().positive().optional(),
  type: z.enum(["delivery", "technical_visit", "installation"]),
  quoteId: z.number().int().positive().nullable().optional(),
  clientId: z.number().int().positive().nullable().optional(),
  clientName: z.string().trim().min(1, "Informe o cliente").max(240),
  phone: phoneField(),
  address: nullableText,
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(15, "Duração mínima de 15 minutos").max(24 * 60),
  responsible: nullableText,
  notes: nullableText,
});

const productInput = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().max(64).optional(),
  reference: z.string().trim().min(1, "Informe a referência do produto").max(64, "A referência pode ter no máximo 64 caracteres"),
  shortDescription: z.string().trim().min(1, "Informe a descrição curta").max(512),
  fullDescription: nullableText,
  imageUrl: imageLocation.nullable().optional().or(z.literal("")),
  imageKey: nullableText,
  barcode: z.string().trim().max(64).nullable().optional().or(z.literal("")),
  unit: z.string().trim().min(1).max(16).refine((value) => !isNumericUnit(value), NUMERIC_UNIT_MESSAGE).default("UN"),
  supplierName: z.string().trim().max(240).nullable().optional().or(z.literal("")),
  unitPrice: money,
  costPrice: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
  copyCostFrom: z.number().int().positive().optional(),
  reorderPoint: money,
  warrantyMonths: z.coerce.number().int().min(0).max(120).nullable().optional(),
  active: z.boolean().default(true),
  initialStock: z.coerce.number().min(0, "O estoque inicial não pode ser negativo.").max(99_999).refine(isCentQuantity, "Use no máximo 2 casas decimais no estoque inicial.").optional(),
});

const importDecimal = (label: string, max = 99_999_999) => z.number().min(0, `${label} inválido.`).max(max, `${label} inválido.`).refine(isCentQuantity, `${label}: use no máximo 2 casas decimais.`).optional();
const importRowInput = z.object({
  line: z.number().int().min(1),
  reference: z.string().trim().min(1, "Informe a referência do produto").max(64, "A referência pode ter no máximo 64 caracteres"),
  shortDescription: z.string().trim().min(1).max(512).optional(),
  fullDescription: z.string().trim().max(2000).optional(),
  barcode: z.string().trim().max(64).optional(),
  unit: z.string().trim().min(1).max(16).refine((value) => !isNumericUnit(value), NUMERIC_UNIT_MESSAGE).optional(),
  supplierName: z.string().trim().max(240).optional(),
  unitPrice: importDecimal("Valor de venda"),
  costPrice: importDecimal("Preço de custo"),
  initialStock: importDecimal("Quantidade em estoque", 99_999),
  reorderPoint: importDecimal("Ponto de reposição"),
  warrantyMonths: z.number().int().min(0).max(120).optional(),
  active: z.boolean().optional(),
  imageUrl: imageLocation.optional(),
  imageKey: z.string().trim().max(2000).optional(),
});

const quoteItemInput = z
  .object({
    id: z.number().int().positive().optional(),
    productId: z.number().int().positive().nullable().optional(),
    code: z.string().trim().max(64).default(""),
    shortDescription: z.string().trim().min(1, "Informe a descrição do item").max(512),
    imageUrl: itemImageLocation.nullable().optional().or(z.literal("")),
    unit: z.string().trim().max(16).default("UN").transform(cleanUnit),
    quantity: z.coerce.number().positive("A quantidade deve ser maior que zero").max(99999).refine(isCentQuantity, "Use no máximo 2 casas decimais na quantidade"),
    unitPrice: money,
  })
  // quantity e unitPrice já têm limites individuais acima, mas o PRODUTO
  // dos dois (o total da linha) ainda pode ultrapassar o que a coluna
  // decimal(12,2) do banco comporta, mesmo com os dois campos
  // isoladamente "válidos" — o que só quebraria muito mais adiante, na
  // criação da cobrança financeira ao aprovar o orçamento, com um erro
  // cru de banco em vez desta mensagem clara.
  .refine((item) => item.quantity * item.unitPrice <= 99_999_999, {
    message: "O total deste item é grande demais. Revise a quantidade e o valor unitário.",
    path: ["unitPrice"],
  });

const quoteInput = z.object({
  id: z.number().int().positive().optional(),
  quoteNumber: z.number().int().positive().optional(),
  clientId: z.number().int().positive().nullable().optional(),
  clientName: z.string().trim().max(240).default(""),
  professional: z.string().trim().max(240).default(""),
  document: documentField(),
  stateRegistration: nullableText,
  phone: phoneField(),
  address: nullableText,
  status: z.enum(["draft", "open", "approved", "lost"]).default("draft"),
  issueDate: z.coerce.date(),
  validUntil: z.coerce.date().nullable().optional(),
  discountMode: z.enum(["percentage", "fixed"]).default("percentage"),
  discountValue: money,
  shipping: money,
  pixDiscountMode: z.enum(["percentage", "fixed"]).default("percentage"),
  pixDiscountValue: money,
  installments: z.coerce.number().int().min(1).max(24).default(8),
  paymentPlan: z.object({
    parts: z.array(z.object({
      method: z.enum(PLAN_METHODS),
      amount: z.coerce.number().positive().max(99_999_999),
      installments: z.coerce.number().int().min(1).max(MAX_PLAN_INSTALLMENTS),
      firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })).min(1).max(MAX_PLAN_PARTS),
  }).nullable().optional(),
  entryOffer: z.object({
    entryPercent: z.coerce.number().min(1).max(90),
    installments: z.coerce.number().int().min(1).max(MAX_PLAN_INSTALLMENTS),
  }).nullable().optional(),
  notes: nullableText,
  followUpAt: z.coerce.date().nullable().optional(),
  lostReason: z.enum(LOST_REASONS).nullable().optional(),
  lostNotes: z.string().trim().max(500).nullable().optional(),
  rooms: z.array(z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1, "Informe o nome do ambiente").max(160),
    items: z.array(quoteItemInput),
  })).min(1, "Inclua ao menos um ambiente"),
});

export const businessRouter = router({
  // Quem não tem acesso ao Financeiro vê o painel sem os valores recebidos.
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const data = await dashboardMetrics();
    if (canAccess(ctx.user.role, "finance")) return data;
    const withoutFinance = { ...data, finance: null, monthly: data.monthly.map((month) => ({ ...month, received: 0 })) };
    if (canAccess(ctx.user.role, "quotes")) return withoutFinance;
    // A expedição vê as quantidades, não quanto a loja vendeu.
    return { ...withoutFinance, approvedRevenue: 0, quotedTotal: 0, approvedValue: 0, pendingValue: 0, rejectedValue: 0, statusSummary: data.statusSummary.map((entry) => ({ ...entry, value: 0 })), monthly: [], expirationAlerts: [], followUps: [] };
  }),
  customers: router({
    // CPF, telefone e e-mail: só quem atende o cliente.
    list: areaProcedure("customers", "quotes").input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listClients(input?.search)),
    save: areaProcedure("customers").input(clientInput).mutation(async ({ ctx, input }) => {
      const id = await saveClient({ ...input, email: input.email || null });
      await log(ctx, { action: input.id ? "customer.update" : "customer.create", entityType: "customer", entityId: id, summary: `${input.id ? "Atualizou" : "Cadastrou"} o cliente ${input.name}` });
      return id;
    }),
    statement: areaProcedure("customers").input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
      const statement = await customerStatement(input.id);
      if (!statement) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
      return statement;
    }),
  }),
  product: router({
    list: protectedProcedure.input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listProducts(input?.search)),
    save: areaProcedure("catalog").input(productInput).mutation(async ({ ctx, input }) => {
      const before = input.id ? await getProduct(input.id) : null;
      // Lançar estoque continua sendo de quem tem acesso ao Estoque.
      if (input.initialStock && !canAccess(ctx.user.role, "stock")) throw new TRPCError({ code: "FORBIDDEN", message: "Seu perfil não lança estoque. Peça à expedição para registrar a entrada." });
      if (input.initialStock && input.id) throw new TRPCError({ code: "BAD_REQUEST", message: "O saldo de um produto já cadastrado muda em Estoque > Movimentar estoque." });
      // Quem não vê o custo também não pode alterá-lo. Ao duplicar um produto,
      // a cópia leva o custo do original mesmo assim.
      const { copyCostFrom, ...fields } = input;
      const copied = copyCostFrom && !input.id && !canSeeCost(ctx.user.role) ? await getProduct(copyCostFrom) : null;
      const costPrice = canSeeCost(ctx.user.role) ? input.costPrice : copied?.costPrice != null ? Number(copied.costPrice) : undefined;
      const id = await saveProduct({ ...fields, costPrice, imageUrl: input.imageUrl || null, responsible: ctx.user.name || ctx.user.username }).catch((error) => {
        // Dois cadastros ao mesmo tempo com a mesma referência ou código de barras.
        if (isDuplicateEntry(error)) throw new TRPCError({ code: "CONFLICT", message: "Esta referência ou código de barras acabou de ser usado em outro produto." });
        throw error;
      });
      // Fornecedor novo digitado no cadastro já fica na lista para os próximos.
      await ensureSupplier(input.supplierName);
      const saved = (await getProduct(id))!;
      if (!before) {
        await log(ctx, { action: "product.create", entityType: "product", entityId: id, summary: `Cadastrou o produto ${saved.shortDescription} (${brl(input.unitPrice)})${input.initialStock ? `, com estoque inicial de ${input.initialStock} ${saved.unit}` : ""}` });
      } else {
        const changes = changedFields(before as Record<string, unknown>, saved as Record<string, unknown>, ["reference", "barcode", "shortDescription", "unitPrice", "costPrice", "reorderPoint", "warrantyMonths", "supplierName", "unit", "active"]);
        if (Object.keys(changes).length) {
          const price = changes.unitPrice ? `: preço ${brl(Number(changes.unitPrice.de))} → ${brl(Number(changes.unitPrice.para))}` : "";
          await log(ctx, { action: changes.unitPrice ? "product.price" : "product.update", entityType: "product", entityId: id, summary: `Alterou o produto #${before.code} ${input.shortDescription}${price}`, details: changes });
        }
      }
      return id;
    }),
    // A tela envia em lotes, para mostrar o andamento. Cada linha responde sozinha.
    importRows: areaProcedure("catalog").input(z.object({
      mode: z.enum(["skip", "update"]),
      rows: z.array(z.unknown()).min(1).max(200),
    })).mutation(async ({ ctx, input }) => {
      const access = { canSeeCost: canSeeCost(ctx.user.role), canStock: canAccess(ctx.user.role, "stock"), responsible: ctx.user.name || ctx.user.username };
      const results: ImportResult[] = [];
      for (const raw of input.rows) {
        const parsed = importRowInput.safeParse(raw);
        if (!parsed.success) {
          const line = Number((raw as { line?: unknown } | null)?.line) || 0;
          results.push({ line, reference: String((raw as { reference?: unknown } | null)?.reference ?? ""), status: "error", message: parsed.error.issues[0]?.message ?? "Linha inválida." });
          continue;
        }
        results.push(await importProductRow(parsed.data, input.mode, access));
      }
      const count = (status: ImportResult["status"]) => results.filter((result) => result.status === status).length;
      const lines = results.map((result) => result.line);
      const priceChanges = results.flatMap((result) => (result.priceChange ? [{ referencia: result.reference, ...result.priceChange }] : []));
      await log(ctx, {
        action: "product.import",
        entityType: "product",
        summary: `Importou produtos por planilha (linhas ${Math.min(...lines)} a ${Math.max(...lines)}): ${count("created")} novos, ${count("updated")} atualizados, ${count("skipped")} ignorados, ${count("error")} com erro`,
        details: {
          novos: results.filter((result) => result.status === "created").map((result) => result.reference),
          atualizados: results.filter((result) => result.status === "updated").map((result) => result.reference),
          ...(priceChanges.length ? { precosAlterados: priceChanges } : {}),
        },
      });
      return results;
    }),
    setBarcode: areaProcedure("catalog").input(z.object({ productId: z.number().int().positive(), barcode: z.string().trim().max(64).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const problem = barcodeProblem(input.barcode);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      try {
        const result = await updateProductBarcode(input.productId, normalizeBarcode(input.barcode));
        await log(ctx, { action: "product.barcode", entityType: "product", entityId: input.productId, summary: input.barcode ? `Vinculou o código de barras ${input.barcode} ao produto #${input.productId}` : `Removeu o código de barras do produto #${input.productId}` });
        return result;
      } catch (error) {
        if (isDuplicateEntry(error)) throw new TRPCError({ code: "CONFLICT", message: "Este código de barras já está vinculado a outro produto." });
        throw error;
      }
    }),
    availability: areaProcedure("quotes", "stock", "catalog").query(productAvailability),
    findByBarcode: protectedProcedure.input(z.object({ barcode: z.string().trim().min(3).max(64) })).query(({ input }) => findProductByBarcode(input.barcode)),
    archive: areaProcedure("catalog").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const product = await getProduct(input.id);
      await deleteProduct(input.id);
      await log(ctx, { action: "product.archive", entityType: "product", entityId: input.id, summary: `Arquivou o produto #${product?.code ?? input.id} ${product?.shortDescription ?? ""}`.trim() });
    }),
    uploadImage: areaProcedure("catalog").input(z.object({
      fileName: z.string().trim().min(1).max(120),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      dataUrl: z.string().min(32).max(7_000_000),
    })).mutation(async ({ input }) => {
      const separator = input.dataUrl.indexOf(",");
      if (separator === -1) throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo de imagem inválido" });
      const bytes = Buffer.from(input.dataUrl.slice(separator + 1), "base64");
      if (bytes.length > 5 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "A imagem deve ter no máximo 5 MB" });
      const extension = input.mimeType.split("/")[1];
      const safeBase = input.fileName.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
      return saveLocalImage("products", safeBase, input.mimeType, bytes);
    }),
  }),
  suppliers: router({
    list: areaProcedure("catalog", "stock", "purchases").query(() => listSuppliers()),
    create: areaProcedure("catalog").input(z.object({ name: z.string().trim().min(1, "Informe o nome do fornecedor").max(240) })).mutation(async ({ ctx, input }) => {
      await ensureSupplier(input.name);
      await log(ctx, { action: "supplier.create", entityType: "product", summary: `Cadastrou o fornecedor ${input.name}` });
      return { name: input.name };
    }),
    rename: areaProcedure("catalog").input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(1, "Informe o nome do fornecedor").max(240) })).mutation(async ({ ctx, input }) => {
      const result = await renameSupplier(input.id, input.name);
      await log(ctx, { action: "supplier.rename", entityType: "product", entityId: input.id, summary: `Renomeou o fornecedor ${result.before} para ${result.name}` });
      return result;
    }),
  }),
  quote: router({
    list: areaProcedure("quotes", "pdfs").query(listQuotes),
    options: areaProcedure("quotes", "agenda", "pdfs").query(() => quoteOptions()),
    listPaged: areaProcedure("quotes", "pdfs")
      .input(
        z
          .object({
            search: z.string().optional(),
            status: z.enum(["all", "pending", "approved", "lost"]).optional(),
            expiration: z.enum(["all", "today", "expired"]).optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .optional()
      )
      .query(({ input }) => listQuotesPaged(input ?? {})),
    get: areaProcedure("quotes", "pdfs").input(z.object({ id: z.number().int().positive() })).query(({ input }) => getQuote(input.id)),
    lockInfo: areaProcedure("quotes").input(z.object({ id: z.number().int().positive() })).query(({ input }) => quoteLockInfo(input.id)),
    create: areaProcedure("quotes").mutation(async ({ ctx }) => {
      const created = await createQuote(ctx.user.id);
      if (created) await log(ctx, { action: "quote.create", entityType: "quote", entityId: created.id, summary: `Criou o orçamento #${created.quoteNumber}` });
      return created;
    }),
    // O editor salva sozinho enquanto a pessoa digita; por isso só mudanças
    // de status entram no registro de atividades, não cada edição.
    save: areaProcedure("quotes").input(quoteInput).mutation(async ({ ctx, input }) => {
      const before = input.id ? await getQuote(input.id) : null;
      if (input.status === "lost" && before?.status !== "lost" && !input.lostReason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o motivo de não aprovação." });
      }
      if (input.status === "approved" && before?.status !== "approved" && ctx.user.role === "sales") {
        const problem = saleLimitProblem(input, await getSettings(), await productCosts(input.rooms.flatMap((room) => room.items.flatMap((item) => (item.productId ? [item.productId] : [])))));
        if (problem) throw new TRPCError({ code: "FORBIDDEN", message: problem });
      }
      const saved = await saveQuote(input, ctx.user.id);
      if (saved && before && before.status !== saved.status) {
        const verb = saved.status === "approved" ? "Aprovou" : saved.status === "lost" ? "Marcou como não aprovado" : `Mudou para ${STATUS_LABELS[saved.status]}`;
        await log(ctx, { action: `quote.${saved.status}`, entityType: "quote", entityId: saved.id, summary: `${verb} o orçamento #${saved.quoteNumber} (${saved.clientName || "sem cliente"}, ${brl(saved.summary.total)})${saved.status === "lost" && saved.lostReason ? ` — motivo: ${LOST_REASON_LABELS[saved.lostReason].toLowerCase()}` : ""}`, details: { de: before.status, para: saved.status, motivo: saved.lostNotes ?? undefined } });
      }
      return saved;
    }),
    // "Retorno feito": registra o contato e agenda o próximo.
    followUpDone: areaProcedure("quotes").input(z.object({ id: z.number().int().positive(), days: z.number().int().min(1).max(60), note: z.string().trim().max(300).optional() })).mutation(async ({ ctx, input }) => {
      const result = await registerFollowUp(input.id, input.days);
      await log(ctx, { action: "quote.followup", entityType: "quote", entityId: input.id, summary: `Registrou retorno do orçamento #${result.quoteNumber}${result.clientName ? ` (${result.clientName})` : ""}; próximo em ${plural(input.days, "dia", "dias")}${input.note ? `: ${input.note}` : ""}` });
      return result;
    }),
    delete: areaProcedure("quotes").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const quote = await getQuote(input.id);
      await deleteQuote(input.id);
      await log(ctx, { action: "quote.delete", entityType: "quote", entityId: input.id, summary: `Excluiu o orçamento #${quote?.quoteNumber ?? input.id}${quote?.clientName ? ` (${quote.clientName})` : ""}` });
    }),
    duplicate: areaProcedure("quotes").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const source = await getQuote(input.id);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      const fresh = await createQuote(ctx.user.id);
      if (!fresh) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a cópia do orçamento" });
      const copy = await saveQuote({
        ...source,
        id: fresh.id,
        quoteNumber: fresh.quoteNumber,
        status: "draft",
        paymentPlan: null,
        entryOffer: parseEntryOffer(source.entryOffer),
        issueDate: new Date(),
        rooms: source.rooms.map((room) => ({ name: room.name, items: room.items.map((item) => ({
          productId: item.productId,
          code: item.code,
          shortDescription: item.shortDescription,
          imageUrl: item.imageUrl,
          unit: item.unit,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
        })) })),
        discountValue: Number(source.discountValue),
        shipping: Number(source.shipping),
        pixDiscountValue: Number(source.pixDiscountValue),
      }, ctx.user.id);
      if (copy) await log(ctx, { action: "quote.duplicate", entityType: "quote", entityId: copy.id, summary: `Duplicou o orçamento #${source.quoteNumber} como #${copy.quoteNumber}` });
      return copy;
    }),
    pdfHistory: areaProcedure("quotes", "pdfs").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listQuotePdfHistory(input.quoteId)),
    pdfHistoryAll: areaProcedure("quotes", "pdfs").query(listAllQuotePdfHistory),
    pdfSnapshot: areaProcedure("quotes", "pdfs").input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
      const entry = await getQuotePdfSnapshot(input.id);
      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "PDF não encontrado no histórico." });
      return entry;
    }),
    versions: areaProcedure("quotes").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listQuoteVersions(input.quoteId)),
    createVersion: areaProcedure("quotes").input(z.object({ quoteId: z.number().int().positive(), changeNote: z.string().trim().max(512).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const quote = await getQuote(input.quoteId);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
      return createQuoteVersion({ quoteId: input.quoteId, snapshot: quote, changeNote: input.changeNote, userId: ctx.user.id });
    }),
    restoreVersion: areaProcedure("quotes").input(z.object({ versionId: z.number().int().positive(), comment: z.string().trim().min(10, "Informe uma justificativa com pelo menos 10 caracteres.").max(4000) })).mutation(async ({ ctx, input }) => {
      const result = await restoreQuoteVersion({ ...input, userId: ctx.user.id });
      await log(ctx, { action: "quote.restore", entityType: "quote", entityId: result.quoteId, summary: `Restaurou a versão ${result.sourceVersion} do orçamento`, details: { justificativa: input.comment } });
      return result;
    }),
    comments: areaProcedure("quotes").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listComments(input.quoteId)),
    addComment: areaProcedure("quotes").input(z.object({ quoteId: z.number().int().positive(), body: z.string().trim().min(1).max(4000) })).mutation(({ ctx, input }) => addComment({ ...input, userId: ctx.user.id })),
    resolveComment: areaProcedure("quotes").input(z.object({ id: z.number().int().positive(), resolved: z.boolean() })).mutation(({ input }) => resolveComment(input.id, input.resolved)),
    attachments: areaProcedure("quotes").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listAttachments(input.quoteId)),
    uploadAttachment: areaProcedure("quotes").input(z.object({ quoteId: z.number().int().positive(), fileName: z.string().trim().min(1).max(180), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]), dataUrl: z.string().min(32).max(22_000_000) })).mutation(async ({ ctx, input }) => {
      const separator = input.dataUrl.indexOf(",");
      if (separator === -1) throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo inválido." });
      const bytes = Buffer.from(input.dataUrl.slice(separator + 1), "base64");
      if (!(await getQuote(input.quoteId))) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
      try { const stored = await saveLocalAttachment(input.fileName, input.mimeType, bytes); const attachment = await addAttachment({ quoteId: input.quoteId, fileName: input.fileName, mimeType: input.mimeType, storageKey: stored.key, fileSize: stored.fileSize, userId: ctx.user.id }); await log(ctx, { action: "quote.attachment", entityType: "quote", entityId: input.quoteId, summary: `Anexou ${input.fileName} ao orçamento` }); return attachment; }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar o anexo." }); }
    }),
    // Guarda os dados do PDF, não o arquivo: o PDF é montado de novo ao baixar.
    savePdf: areaProcedure("quotes").input(z.object({
      quoteId: z.number().int().positive(),
      snapshot: z.string().min(2).max(2_000_000),
      fileSize: z.number().int().min(0).max(50_000_000),
      // Valores da tela no momento da geração: o salvamento automático pode
      // ainda não ter gravado uma edição recente do nome.
      clientName: z.string().max(240).optional(),
      professional: z.string().max(240).optional(),
    })).mutation(async ({ ctx, input }) => {
      let snapshot: string;
      try {
        const parsed = JSON.parse(input.snapshot) as { rooms?: unknown; summary?: unknown; settings?: unknown };
        if (!parsed || !Array.isArray(parsed.rooms) || !parsed.summary || typeof parsed.summary !== "object") throw new Error();
        snapshot = JSON.stringify(sanitizePdfSnapshot(parsed));
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Dados do PDF inválidos." });
      }
      const quote = await getQuote(input.quoteId);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
      const fileName = quotePdfFileName({ quoteNumber: quote.quoteNumber, clientName: input.clientName ?? quote.clientName, professional: input.professional ?? quote.professional });
      return createQuotePdfHistory({ quoteId: quote.id, createdByUserId: ctx.user.id, fileName, snapshot, fileSize: input.fileSize });
    }),
  }),
  finance: router({
    overview: areaProcedure("finance").query(financeOverview),
    legacy: areaProcedure("finance").query(() => legacyApprovedQuotes()),
    settleLegacy: areaProcedure("finance").input(z.object({
      quoteId: z.number().int().positive(),
      method: z.enum(["credit_card", "boleto", "store_credit"]),
      installments: z.coerce.number().int().min(1).max(24),
      paidAt: z.coerce.date(),
    })).mutation(async ({ ctx, input }) => {
      const quote = await settleLegacyQuote(input, ctx.user.id);
      const what = input.method === "credit_card" ? `pago no cartão em ${input.installments}x: parcelas canceladas e recebimento de ${brl(quote.amount)} registrado` : `parcelas mantidas como ${input.method === "boleto" ? "boleto" : "crediário próprio"}`;
      await log(ctx, { action: "finance.plan", entityType: "finance", entityId: quote.id, summary: `Revisou a forma de pagamento do orçamento #${quote.quoteNumber} (${quote.clientName}): ${what}` });
      return { ok: true };
    }),
    clients: areaProcedure("finance").query(financeClients),
    byQuote: areaProcedure("finance").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => financeByQuote(input.quoteId)),
    create: areaProcedure("finance").input(z.object({
      quoteId: z.number().int().positive().nullable().optional(),
      clientId: z.number().int().positive().nullable().optional(),
      clientName: z.string().trim().min(1, "Informe o cliente").max(240),
      description: z.string().trim().min(1, "Informe a descrição").max(512),
      totalAmount: money.refine((value) => value > 0, "Informe um valor maior que zero"),
      installmentCount: z.coerce.number().int().min(1).max(24).default(1),
      firstDueDate: z.coerce.date(),
    })).mutation(async ({ ctx, input }) => {
      const ids = await createReceivables(input, ctx.user.id);
      await log(ctx, { action: "finance.create", entityType: "finance", entityId: ids[0] ?? null, summary: `Lançou cobrança de ${brl(input.totalAmount)} em ${input.installmentCount}x para ${input.clientName}: ${input.description}` });
      return ids;
    }),
    recordPayment: areaProcedure("finance").input(z.object({
      receivableId: z.number().int().positive(),
      type: z.enum(["receipt", "reversal"]),
      amount: money.refine((value) => value > 0, "Informe um valor maior que zero"),
      paymentMethod: z.enum(["pix", "cash", "credit_card", "debit_card", "bank_transfer", "boleto", "store_credit", "other"]),
      paidAt: z.coerce.date(),
      reference: z.string().trim().max(120).nullable().optional(),
      notes: nullableText,
    })).mutation(async ({ ctx, input }) => {
      const result = await recordFinancePayment(input, ctx.user.id);
      const receivable = await getReceivableSummary(input.receivableId);
      const where = receivable ? `na parcela ${receivable.installmentNumber}/${receivable.installmentCount} de ${receivable.clientName}${receivable.quoteNumber ? ` (orçamento #${receivable.quoteNumber})` : ""}` : `na cobrança #${input.receivableId}`;
      await log(ctx, { action: input.type === "receipt" ? "finance.receipt" : "finance.reversal", entityType: "finance", entityId: input.receivableId, summary: `${input.type === "receipt" ? "Registrou recebimento" : "Estornou"} de ${brl(input.amount)} ${where}`, details: { forma: input.paymentMethod, referencia: input.reference ?? null, observacao: input.notes ?? null } });
      return result;
    }),
    cancel: areaProcedure("finance").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const result = await cancelReceivable(input.id);
      const receivable = await getReceivableSummary(input.id);
      await log(ctx, { action: "finance.cancel", entityType: "finance", entityId: input.id, summary: `Cancelou a cobrança ${receivable ? `${receivable.installmentNumber}/${receivable.installmentCount} de ${receivable.clientName} (${brl(receivable.originalAmount)})` : `#${input.id}`}` });
      return result;
    }),
    message: areaProcedure("finance").input(z.object({ receivableId: z.number().int().positive() })).query(async ({ input }) => {
      try {
        return await messageForReceivable(input.receivableId);
      } catch (error) {
        throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "Cobrança não encontrada." });
      }
    }),
  }),
  inventory: router({
    overview: areaProcedure("stock").query(inventoryOverview),
    fulfillments: areaProcedure("stock").query(approvedFulfillments),
    quoteFulfillment: areaProcedure("stock").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => fulfillmentLines([input.quoteId])),
    purchases: areaProcedure("purchases").query(purchaseSuggestions),
    stale: areaProcedure("stock").input(z.object({ days: z.number().int().min(1).max(3650) })).query(({ input }) => staleStockReport(input.days)),
    abc: areaProcedure("stock").input(periodInput).query(({ input }) => abcReport(input)),
    picking: areaProcedure("stock", "quotes").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => getPickingList(input.quoteId)),
    move: areaProcedure("stock").input(z.object({
      productId: z.number().int().positive(),
      type: z.enum(["entry", "adjustment", "return"]),
      quantity: z.coerce.number().refine((value) => value !== 0 && Math.abs(value) <= 99_999 && isCentQuantity(value), "Informe uma quantidade válida, com até 2 casas decimais"),
      notes: nullableText,
      occurredAt: z.coerce.date(),
    }).refine((input) => input.type === "adjustment" || input.quantity > 0, { message: "Entrada e devolução têm quantidade positiva. Para tirar do saldo, use Ajuste.", path: ["quantity"] })).mutation(async ({ ctx, input }) => {
      // O responsável é sempre quem está logado: não vem da tela.
      const responsible = ctx.user.name || ctx.user.username;
      const result = await recordStockMovement({ ...input, responsible });
      const product = await getProduct(input.productId);
      const label = { entry: "Entrada", adjustment: "Ajuste", return: "Devolução" }[input.type];
      await log(ctx, { action: `stock.${input.type}`, entityType: "stock", entityId: input.productId, summary: `${label} de estoque: ${input.quantity > 0 && input.type === "adjustment" ? "+" : ""}${input.quantity} ${product?.unit ?? ""} em #${product?.code ?? input.productId} ${product?.shortDescription ?? ""} (saldo ${result.beforeQuantity} → ${result.afterQuantity})`.replace(/\s+/g, " "), details: { responsavel: responsible, observacao: input.notes ?? null } });
      return result;
    }),
    deliver: areaProcedure("stock").input(z.object({
      quoteId: z.number().int().positive(),
      quoteItemId: z.number().int().positive(),
      quantity: deliveryQuantity,
      ...deliveryMeta,
    })).mutation(async ({ ctx, input }) => {
      const result = await deliverQuoteItem(input);
      await logDelivery(ctx, input.quoteId, [result], input.responsible);
      return result;
    }),
    // Vários itens de uma vez (conferência por código de barras).
    deliverMany: areaProcedure("stock").input(z.object({
      quoteId: z.number().int().positive(),
      lines: z.array(z.object({ quoteItemId: z.number().int().positive(), quantity: deliveryQuantity })).min(1).max(500),
      ...deliveryMeta,
    })).mutation(async ({ ctx, input }) => {
      const results = await deliverQuoteItems(input);
      await logDelivery(ctx, input.quoteId, results, input.responsible);
      return results;
    }),
    deliverAll: areaProcedure("stock").input(z.object({ quoteId: z.number().int().positive(), ...deliveryMeta })).mutation(async ({ ctx, input }) => {
      const results = await deliverAllAvailable(input);
      await logDelivery(ctx, input.quoteId, results, input.responsible);
      return results;
    }),
    cancelRemainder: areaProcedure("stock").input(z.object({
      quoteId: z.number().int().positive(),
      lines: z.array(z.object({ quoteItemId: z.number().int().positive(), quantity: deliveryQuantity })).min(1).max(500),
      reason: correctionReason,
    })).mutation(async ({ ctx, input }) => {
      const result = await cancelRemainder(input, ctx.user.id);
      await log(ctx, { action: "stock.cancel_remainder", entityType: "stock", entityId: input.quoteId, summary: `Cancelou saldo de ${plural(input.lines.length, "item", "itens")} do orçamento #${result.quoteNumber}${result.clientName ? ` (${result.clientName})` : ""}: ${brl(result.amount)}`, details: { motivo: input.reason } });
      return result;
    }),
    undoCancellation: areaProcedure("stock").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const result = await undoCancellation(input.id, ctx.user.id);
      await log(ctx, { action: "stock.undo_cancel", entityType: "stock", entityId: input.id, summary: `Desfez o cancelamento de ${result.quantity} no orçamento #${result.quoteNumber}${result.clientName ? ` (${result.clientName})` : ""}` });
      return result;
    }),
    reverseDelivery: areaProcedure("stock").input(z.object({ deliveryId: z.number().int().positive(), reason: correctionReason, responsible: nullableText })).mutation(async ({ ctx, input }) => {
      const result = await reverseDelivery(input, ctx.user.id);
      await log(ctx, { action: "stock.reverse_delivery", entityType: "stock", entityId: input.deliveryId, summary: `Estornou a retirada de ${result.quantity} do orçamento #${result.quoteNumber}${result.clientName ? ` (${result.clientName})` : ""}`, details: { motivo: input.reason } });
      return result;
    }),
  }),
  agenda: router({
    list: areaProcedure("agenda").input(z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((range) => range.to > range.from && range.to.getTime() - range.from.getTime() <= 62 * 24 * 60 * 60_000, "Período inválido")).query(({ input }) => listAppointments(input)),
    upcoming: areaProcedure("agenda").query(() => upcomingAppointments(6)),
    conflicts: areaProcedure("agenda").input(z.object({ id: z.number().int().positive().optional(), responsible: z.string().max(240).nullable().optional(), scheduledAt: z.coerce.date(), durationMinutes: z.number().int().min(15).max(24 * 60) })).query(({ input }) => findConflicts(input)),
    save: areaProcedure("agenda").input(appointmentInput).mutation(async ({ ctx, input }) => {
      const saved = await saveAppointment(input, ctx.user.id);
      const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(saved.scheduledAt);
      await log(ctx, { action: input.id ? "appointment.update" : "appointment.create", entityType: "appointment", entityId: saved.id, summary: `${input.id ? "Alterou" : "Agendou"} ${APPOINTMENT_TYPE_LABELS[saved.type].toLowerCase()} de ${saved.clientName} para ${when}` });
      return saved;
    }),
    setStatus: areaProcedure("agenda").input(z.object({ id: z.number().int().positive(), status: z.enum(["scheduled", "done", "cancelled"]) })).mutation(async ({ ctx, input }) => {
      const saved = await setAppointmentStatus(input.id, input.status);
      await log(ctx, { action: `appointment.${input.status}`, entityType: "appointment", entityId: saved.id, summary: `Marcou ${APPOINTMENT_TYPE_LABELS[saved.type].toLowerCase()} de ${saved.clientName} como ${APPOINTMENT_STATUS_LABELS[input.status].toLowerCase()}` });
      return saved;
    }),
    delete: areaProcedure("agenda").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const removed = await deleteAppointment(input.id);
      await log(ctx, { action: "appointment.delete", entityType: "appointment", entityId: removed.id, summary: `Excluiu ${APPOINTMENT_TYPE_LABELS[removed.type].toLowerCase()} de ${removed.clientName}` });
    }),
  }),
  settings: router({
    get: protectedProcedure.query(getSettings),
    uploadLogo: adminProcedure.input(z.object({
      fileName: z.string().trim().min(1).max(120),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      dataUrl: z.string().min(32).max(7_000_000),
    })).mutation(async ({ input }) => {
      const separator = input.dataUrl.indexOf(",");
      if (separator === -1) throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo de imagem inválido" });
      const bytes = Buffer.from(input.dataUrl.slice(separator + 1), "base64");
      if (bytes.length > 5 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "O logotipo deve ter no máximo 5 MB" });
      const extension = input.mimeType.split("/")[1];
      const safeBase = input.fileName.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
      return saveLocalImage("store-brand", safeBase, input.mimeType, bytes);
    }),
    save: adminProcedure.input(z.object({
      companyName: z.string().trim().min(1).max(256),
      tradingName: z.string().trim().min(1).max(256),
      logoUrl: imageLocation.nullable().optional().or(z.literal("")),
      document: documentField(true),
      address: nullableText,
      phone: phoneField(true),
      email: emailField(),
      pixKey: nullableText,
      pixRecipient: nullableText,
      pixCity: z.string().trim().max(60).nullable().optional(),
      defaultPixDiscountMode: z.enum(["percentage", "fixed"]),
      defaultPixDiscountValue: money,
      defaultInstallments: z.coerce.number().int().min(1).max(24),
      alertThresholdDays: z.coerce.number().int().min(1).max(60),
      followUpDays: z.coerce.number().int().min(1).max(30).default(3),
      maxDiscountPercent: z.coerce.number().min(0).max(100).default(0),
      minMarginPercent: z.coerce.number().min(0).max(100).default(0),
      defaultCommissionPercent: z.coerce.number().min(0).max(100).default(0),
      defaultWarrantyMonths: z.coerce.number().int().min(0).max(120).default(12),
      defaultTerms: nullableText,
    })).mutation(async ({ ctx, input }) => {
      const before = await getSettings();
      const saved = await saveSettings({
        ...input,
        logoUrl: input.logoUrl || null,
        document: input.document || null,
        address: input.address || null,
        phone: input.phone || null,
        email: input.email || null,
        pixKey: input.pixKey || null,
        pixRecipient: input.pixRecipient || null,
        pixCity: input.pixCity || null,
        defaultTerms: input.defaultTerms || null,
        defaultPixDiscountValue: input.defaultPixDiscountValue.toFixed(2),
        maxDiscountPercent: input.maxDiscountPercent.toFixed(2),
        minMarginPercent: input.minMarginPercent.toFixed(2),
        defaultCommissionPercent: input.defaultCommissionPercent.toFixed(2),
      });
      const changes = changedFields(before as Record<string, unknown>, saved as Record<string, unknown>, ["companyName", "tradingName", "logoUrl", "document", "address", "phone", "email", "pixKey", "pixRecipient", "pixCity", "defaultPixDiscountMode", "defaultPixDiscountValue", "defaultInstallments", "alertThresholdDays", "followUpDays", "maxDiscountPercent", "minMarginPercent", "defaultCommissionPercent", "defaultWarrantyMonths", "cardFees", "defaultTerms"]);
      if (Object.keys(changes).length) await log(ctx, { action: "settings.update", entityType: "settings", summary: `Alterou as configurações da loja: ${Object.keys(changes).join(", ")}`, details: changes });
      return saved;
    }),
  }),
  reports: router({
    sales: areaProcedure("reports").input(periodInput).query(async ({ ctx, input }) => {
      const report = await salesReport(input);
      return canSeeCost(ctx.user.role) ? report : withoutCost(report);
    }),
  }),
  commissions: router({
    overview: areaProcedure("finance").input(periodInput).query(({ input }) => commissionReport(input)),
    saveProfessional: areaProcedure("finance").input(z.object({
      name: z.string().trim().min(1, "Informe o nome do profissional").max(240),
      commissionPercent: z.coerce.number().min(0).max(100).nullable(),
      phone: phoneField(),
    })).mutation(async ({ ctx, input }) => {
      const id = await saveProfessional(input);
      await log(ctx, { action: "commission.rate", entityType: "finance", entityId: id, summary: `Definiu a comissão de ${input.name} em ${input.commissionPercent === null ? "padrão da loja" : `${input.commissionPercent}%`}` });
      return id;
    }),
    pay: areaProcedure("finance").input(z.object({
      professional: z.string().trim().min(1).max(240),
      amount: money.refine((value) => value > 0, "Informe um valor maior que zero"),
      paidAt: z.coerce.date(),
      notes: z.string().trim().max(500).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const id = await recordCommissionPayment(input, ctx.user.id);
      await log(ctx, { action: "commission.pay", entityType: "finance", entityId: id, summary: `Registrou pagamento de comissão de ${brl(input.amount)} para ${input.professional}`, details: { observacao: input.notes ?? null } });
      return id;
    }),
    deletePayment: areaProcedure("finance").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const removed = await deleteCommissionPayment(input.id);
      await log(ctx, { action: "commission.delete", entityType: "finance", entityId: input.id, summary: `Excluiu pagamento de comissão de ${brl(removed.amount)} para ${removed.professional}` });
    }),
  }),
  // Resumo do dia: cada seção só vem para quem tem acesso à área.
  summary: router({
    today: protectedProcedure.query(({ ctx }) => dailySummary(ctx.user.role)),
  }),
  templates: router({
    list: areaProcedure("quotes", "finance").query(listMessageTemplates),
    save: areaProcedure("quotes", "finance").input(z.object({ id: z.number().int().positive().optional(), event: z.enum(["quote_sent", "quote_approved", "quote_expiring", "quote_expired", "payment_due", "payment_overdue", "delivery_scheduled", "delivery_completed"]), name: z.string().trim().min(1).max(160), subject: z.string().trim().max(240).nullable().optional(), body: z.string().trim().min(1).max(12000), active: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
      const result = await saveMessageTemplate(input);
      await log(ctx, { action: "message.template", entityType: "message", entityId: result.id, summary: `Salvou o modelo de mensagem "${input.name}" (${MESSAGE_EVENT_LABELS[input.event]})` });
      return result;
    }),
  }),
  messages: router({
    pending: areaProcedure("quotes", "finance").query(() => pendingMessages()),
    forQuote: areaProcedure("quotes", "finance").input(z.object({ quoteId: z.number().int().positive(), event: messageEvent })).query(async ({ input }) => {
      try {
        return await messageForQuote(input.quoteId, input.event);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível montar a mensagem." });
      }
    }),
    // O envio acontece no WhatsApp ou no e-mail da própria pessoa; aqui só
    // registramos que a mensagem foi aberta para envio.
    logSent: areaProcedure("quotes", "finance").input(z.object({ event: messageEvent, channel: z.enum(["whatsapp", "email", "copy"]), clientName: z.string().trim().max(240), quoteId: z.number().int().positive().nullable().optional(), receivableId: z.number().int().positive().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const channel = { whatsapp: "WhatsApp", email: "e-mail", copy: "cópia manual" }[input.channel];
      await log(ctx, { action: `message.${input.channel}`, entityType: "message", entityId: input.receivableId ?? input.quoteId ?? null, summary: `Enviou "${MESSAGE_EVENT_LABELS[input.event]}" para ${input.clientName || "cliente sem nome"} por ${channel}`, details: { quoteId: input.quoteId ?? null, receivableId: input.receivableId ?? null } });
      return { logged: true } as const;
    }),
  }),
  activity: router({
    list: adminProcedure.input(z.object({
      entityType: z.enum(["quote", "product", "finance", "stock", "settings", "user", "auth", "backup", "message", "customer", "aftersales"]).optional(),
      userId: z.number().int().positive().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      search: z.string().trim().max(120).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    }).optional()).query(({ input }) => listActivity({ ...input, entityType: input?.entityType as ActivityEntity | undefined })),
  }),
  backup: router({
    export: adminProcedure.query(async ({ ctx }) => {
      const backup = await exportBackup();
      await log(ctx, { action: "backup.export", entityType: "backup", summary: "Exportou o backup em JSON" });
      return backup;
    }),
    import: adminProcedure.input(z.object({
      data: z.record(z.string(), z.unknown()),
      replace: z.boolean().default(true),
    })).mutation(async ({ ctx, input }) => {
      if (input.data.format !== "luminno-backup" || input.data.version !== 1 || !input.data.data) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este arquivo não é um backup Luminno válido" });
      }
      const result = await importBackup({ data: input.data.data as Record<string, unknown>, replace: input.replace });
      // Backups antigos trazem CPF/CNPJ e telefones em qualquer formato.
      await normalizeStoredContacts({ force: true });
      await log(ctx, { action: "backup.import", entityType: "backup", summary: `Restaurou um backup${input.replace ? " substituindo os dados atuais" : ""}`, details: { exportadoEm: input.data.exportedAt ?? null } });
      return result;
    }),
  }),
});
