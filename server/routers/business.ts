import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { saveLocalAttachment, saveLocalImage, saveLocalPdf } from "../localStorage";
import { addAttachment, addComment, createQuoteVersion, findProductByBarcode, listAttachments, listComments, listMessageTemplates, listQuoteVersions, resolveComment, restoreQuoteVersion, saveMessageTemplate, updateProductBarcode } from "../advancedDb";
import {
  createQuote,
  createQuotePdfHistory,
  customerStatement,
  dashboardMetrics,
  deleteProduct,
  deleteQuote,
  exportBackup,
  getQuote,
  getSettings,
  getPickingList,
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
  saveSettings,
} from "../quoteDb";
import { approvedFulfillments, deliverQuoteItem, inventoryOverview, recordStockMovement } from "../stockDb";
import { cancelReceivable, createReceivables, financeByQuote, financeClients, financeOverview, getReceivableSummary, recordFinancePayment } from "../financeDb";
import { changedFields, formatActivityMoney as brl, listActivity, recordActivity, type ActivityEntity, type ActivityEntry } from "../activityLog";
import { messageForQuote, messageForReceivable, pendingMessages } from "../messagesDb";
import { MESSAGE_EVENT_LABELS } from "../../shared/messages";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

const nullableText = z.string().trim().max(2000).nullable().optional();

type ActivityCtx = { user: { id: number; name: string | null; username: string | null }; req: { ip?: string; socket?: { remoteAddress?: string } } };
const log = (ctx: ActivityCtx, entry: ActivityEntry) => recordActivity(ctx.user, entry, ctx.req);
const STATUS_LABELS = { draft: "rascunho", open: "em aberto", approved: "aprovado", lost: "perdido" } as const;
const messageEvent = z.enum(["quote_sent", "quote_approved", "quote_expiring", "quote_expired", "payment_due", "payment_overdue", "delivery_scheduled", "delivery_completed"]);

function isDuplicateEntry(error: unknown) {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  const mysqlError = cause as { code?: string; errno?: number } | null;
  return mysqlError?.code === "ER_DUP_ENTRY" || mysqlError?.errno === 1062;
}
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
  professional: z.string().trim().min(1, "Informe o profissional responsável").max(240),
  document: nullableText,
  stateRegistration: nullableText,
  phone: nullableText,
  email: z.string().email("Informe um e-mail válido").nullable().optional().or(z.literal("")),
  address: nullableText,
});

const productInput = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().max(64).optional(),
  shortDescription: z.string().trim().min(1, "Informe a descrição curta").max(512),
  fullDescription: nullableText,
  imageUrl: imageLocation.nullable().optional().or(z.literal("")),
  imageKey: nullableText,
  barcode: z.string().trim().max(64).nullable().optional().or(z.literal("")),
  unit: z.string().trim().min(1).max(16).default("UN"),
  supplierName: z.string().trim().max(240).nullable().optional().or(z.literal("")),
  unitPrice: money,
  reorderPoint: money,
  active: z.boolean().default(true),
});

const quoteItemInput = z
  .object({
    id: z.number().int().positive().optional(),
    productId: z.number().int().positive().nullable().optional(),
    code: z.string().trim().max(64).default(""),
    shortDescription: z.string().trim().min(1, "Informe a descrição do item").max(512),
    imageUrl: itemImageLocation.nullable().optional().or(z.literal("")),
    unit: z.string().trim().min(1).max(16).default("UN"),
    quantity: z.coerce.number().positive("A quantidade deve ser maior que zero").max(99999),
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
  document: nullableText,
  stateRegistration: nullableText,
  phone: nullableText,
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
  notes: nullableText,
  rooms: z.array(z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1, "Informe o nome do ambiente").max(160),
    items: z.array(quoteItemInput),
  })).min(1, "Inclua ao menos um ambiente"),
});

export const businessRouter = router({
  dashboard: protectedProcedure.query(dashboardMetrics),
  customers: router({
    list: protectedProcedure.input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listClients(input?.search)),
    save: protectedProcedure.input(clientInput).mutation(async ({ ctx, input }) => {
      const id = await saveClient({ ...input, email: input.email || null });
      await log(ctx, { action: input.id ? "customer.update" : "customer.create", entityType: "customer", entityId: id, summary: `${input.id ? "Atualizou" : "Cadastrou"} o cliente ${input.name}` });
      return id;
    }),
    statement: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
      const statement = await customerStatement(input.id);
      if (!statement) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
      return statement;
    }),
  }),
  product: router({
    list: protectedProcedure.input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listProducts(input?.search)),
    save: protectedProcedure.input(productInput).mutation(async ({ ctx, input }) => {
      const before = input.id ? await getProduct(input.id) : null;
      const id = await saveProduct({ ...input, imageUrl: input.imageUrl || null });
      if (!before) {
        await log(ctx, { action: "product.create", entityType: "product", entityId: id, summary: `Cadastrou o produto ${input.shortDescription} (${brl(input.unitPrice)})` });
      } else {
        const changes = changedFields(before as Record<string, unknown>, input as Record<string, unknown>, ["shortDescription", "unitPrice", "reorderPoint", "supplierName", "unit", "active"]);
        if (Object.keys(changes).length) {
          const price = changes.unitPrice ? `: preço ${brl(Number(changes.unitPrice.de))} → ${brl(Number(changes.unitPrice.para))}` : "";
          await log(ctx, { action: changes.unitPrice ? "product.price" : "product.update", entityType: "product", entityId: id, summary: `Alterou o produto #${before.code} ${input.shortDescription}${price}`, details: changes });
        }
      }
      return id;
    }),
    setBarcode: protectedProcedure.input(z.object({ productId: z.number().int().positive(), barcode: z.string().trim().max(64).nullable().optional() })).mutation(async ({ ctx, input }) => {
      try {
        const result = await updateProductBarcode(input.productId, input.barcode || null);
        await log(ctx, { action: "product.barcode", entityType: "product", entityId: input.productId, summary: input.barcode ? `Vinculou o código de barras ${input.barcode} ao produto #${input.productId}` : `Removeu o código de barras do produto #${input.productId}` });
        return result;
      } catch (error) {
        if (isDuplicateEntry(error)) throw new TRPCError({ code: "CONFLICT", message: "Este código de barras já está vinculado a outro produto." });
        throw error;
      }
    }),
    findByBarcode: protectedProcedure.input(z.object({ barcode: z.string().trim().min(3).max(64) })).query(({ input }) => findProductByBarcode(input.barcode)),
    archive: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const product = await getProduct(input.id);
      await deleteProduct(input.id);
      await log(ctx, { action: "product.archive", entityType: "product", entityId: input.id, summary: `Arquivou o produto #${product?.code ?? input.id} ${product?.shortDescription ?? ""}`.trim() });
    }),
    uploadImage: protectedProcedure.input(z.object({
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
  quote: router({
    list: protectedProcedure.query(listQuotes),
    listPaged: protectedProcedure
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
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input }) => getQuote(input.id)),
    create: protectedProcedure.mutation(async ({ ctx }) => {
      const created = await createQuote();
      if (created) await log(ctx, { action: "quote.create", entityType: "quote", entityId: created.id, summary: `Criou o orçamento #${created.quoteNumber}` });
      return created;
    }),
    // O editor salva sozinho enquanto a pessoa digita; por isso só mudanças
    // de status entram no registro de atividades, não cada edição.
    save: protectedProcedure.input(quoteInput).mutation(async ({ ctx, input }) => {
      const before = input.id ? await getQuote(input.id) : null;
      const saved = await saveQuote(input, ctx.user.id);
      if (saved && before && before.status !== saved.status) {
        const verb = saved.status === "approved" ? "Aprovou" : saved.status === "lost" ? "Marcou como perdido" : `Mudou para ${STATUS_LABELS[saved.status]}`;
        await log(ctx, { action: `quote.${saved.status}`, entityType: "quote", entityId: saved.id, summary: `${verb} o orçamento #${saved.quoteNumber} (${saved.clientName || "sem cliente"}, ${brl(saved.summary.total)})`, details: { de: before.status, para: saved.status } });
      }
      return saved;
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const quote = await getQuote(input.id);
      await deleteQuote(input.id);
      await log(ctx, { action: "quote.delete", entityType: "quote", entityId: input.id, summary: `Excluiu o orçamento #${quote?.quoteNumber ?? input.id}${quote?.clientName ? ` (${quote.clientName})` : ""}` });
    }),
    duplicate: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const source = await getQuote(input.id);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      const fresh = await createQuote();
      if (!fresh) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a cópia do orçamento" });
      const copy = await saveQuote({
        ...source,
        id: fresh.id,
        quoteNumber: fresh.quoteNumber,
        status: "draft",
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
    pdfHistory: protectedProcedure.input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listQuotePdfHistory(input.quoteId)),
    pdfHistoryAll: protectedProcedure.query(listAllQuotePdfHistory),
    versions: protectedProcedure.input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listQuoteVersions(input.quoteId)),
    createVersion: protectedProcedure.input(z.object({ quoteId: z.number().int().positive(), changeNote: z.string().trim().max(512).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const quote = await getQuote(input.quoteId);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
      return createQuoteVersion({ quoteId: input.quoteId, snapshot: quote, changeNote: input.changeNote, userId: ctx.user.id });
    }),
    restoreVersion: protectedProcedure.input(z.object({ versionId: z.number().int().positive(), comment: z.string().trim().min(10, "Informe uma justificativa com pelo menos 10 caracteres.").max(4000) })).mutation(async ({ ctx, input }) => {
      const result = await restoreQuoteVersion({ ...input, userId: ctx.user.id });
      await log(ctx, { action: "quote.restore", entityType: "quote", entityId: result.quoteId, summary: `Restaurou a versão ${result.sourceVersion} do orçamento`, details: { justificativa: input.comment } });
      return result;
    }),
    comments: protectedProcedure.input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listComments(input.quoteId)),
    addComment: protectedProcedure.input(z.object({ quoteId: z.number().int().positive(), body: z.string().trim().min(1).max(4000) })).mutation(({ ctx, input }) => addComment({ ...input, userId: ctx.user.id })),
    resolveComment: protectedProcedure.input(z.object({ id: z.number().int().positive(), resolved: z.boolean() })).mutation(({ input }) => resolveComment(input.id, input.resolved)),
    attachments: protectedProcedure.input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => listAttachments(input.quoteId)),
    uploadAttachment: protectedProcedure.input(z.object({ quoteId: z.number().int().positive(), fileName: z.string().trim().min(1).max(180), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]), dataUrl: z.string().min(32).max(22_000_000) })).mutation(async ({ ctx, input }) => {
      const separator = input.dataUrl.indexOf(",");
      if (separator === -1) throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo inválido." });
      const bytes = Buffer.from(input.dataUrl.slice(separator + 1), "base64");
      if (!(await getQuote(input.quoteId))) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
      try { const stored = await saveLocalAttachment(input.fileName, input.mimeType, bytes); const attachment = await addAttachment({ quoteId: input.quoteId, fileName: input.fileName, mimeType: input.mimeType, storageKey: stored.key, fileSize: stored.fileSize, userId: ctx.user.id }); await log(ctx, { action: "quote.attachment", entityType: "quote", entityId: input.quoteId, summary: `Anexou ${input.fileName} ao orçamento` }); return attachment; }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar o anexo." }); }
    }),
    savePdf: protectedProcedure.input(z.object({
      quoteId: z.number().int().positive(),
      dataUrl: z.string().min(32).max(12_000_000),
    })).mutation(async ({ ctx, input }) => {
      const separator = input.dataUrl.indexOf(",");
      if (!input.dataUrl.startsWith("data:application/pdf") || separator === -1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo PDF inválido." });
      }
      const bytes = Buffer.from(input.dataUrl.slice(separator + 1), "base64");
      if (bytes.length > 8 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "O PDF deve ter no máximo 8 MB." });
      const quote = await getQuote(input.quoteId);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
      const generatedAt = new Date();
      const fileName = `orcamento-${String(quote.quoteNumber).padStart(4, "0")}-${generatedAt.toISOString().replace(/[:.]/g, "-")}.pdf`;
      try {
        const stored = await saveLocalPdf(fileName, bytes);
        return createQuotePdfHistory({ quoteId: quote.id, createdByUserId: ctx.user.id, fileName, storageKey: stored.key, fileSize: stored.fileSize });
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar o PDF." });
      }
    }),
  }),
  finance: router({
    overview: protectedProcedure.query(financeOverview),
    clients: protectedProcedure.query(financeClients),
    byQuote: protectedProcedure.input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => financeByQuote(input.quoteId)),
    create: protectedProcedure.input(z.object({
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
    recordPayment: protectedProcedure.input(z.object({
      receivableId: z.number().int().positive(),
      type: z.enum(["receipt", "reversal"]),
      amount: money.refine((value) => value > 0, "Informe um valor maior que zero"),
      paymentMethod: z.enum(["pix", "cash", "credit_card", "debit_card", "bank_transfer", "boleto", "other"]),
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
    cancel: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const result = await cancelReceivable(input.id);
      const receivable = await getReceivableSummary(input.id);
      await log(ctx, { action: "finance.cancel", entityType: "finance", entityId: input.id, summary: `Cancelou a cobrança ${receivable ? `${receivable.installmentNumber}/${receivable.installmentCount} de ${receivable.clientName} (${brl(receivable.originalAmount)})` : `#${input.id}`}` });
      return result;
    }),
    message: protectedProcedure.input(z.object({ receivableId: z.number().int().positive() })).query(async ({ input }) => {
      try {
        return await messageForReceivable(input.receivableId);
      } catch (error) {
        throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "Cobrança não encontrada." });
      }
    }),
  }),
  inventory: router({
    overview: protectedProcedure.query(inventoryOverview),
    fulfillments: protectedProcedure.query(approvedFulfillments),
    picking: protectedProcedure.input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => getPickingList(input.quoteId)),
    move: protectedProcedure.input(z.object({
      productId: z.number().int().positive(),
      type: z.enum(["entry", "adjustment", "return"]),
      quantity: z.coerce.number().refine((value) => value !== 0 && Math.abs(value) <= 99_999, "Informe uma quantidade válida"),
      responsible: nullableText,
      notes: nullableText,
      occurredAt: z.coerce.date(),
    })).mutation(async ({ ctx, input }) => {
      const result = await recordStockMovement(input);
      const product = await getProduct(input.productId);
      const label = { entry: "Entrada", adjustment: "Ajuste", return: "Devolução" }[input.type];
      await log(ctx, { action: `stock.${input.type}`, entityType: "stock", entityId: input.productId, summary: `${label} de estoque: ${input.quantity > 0 && input.type === "adjustment" ? "+" : ""}${input.quantity} ${product?.unit ?? ""} em #${product?.code ?? input.productId} ${product?.shortDescription ?? ""} (saldo ${result.beforeQuantity} → ${result.afterQuantity})`.replace(/\s+/g, " "), details: { responsavel: input.responsible ?? null, observacao: input.notes ?? null } });
      return result;
    }),
    deliver: protectedProcedure.input(z.object({
      quoteId: z.number().int().positive(),
      quoteItemId: z.number().int().positive(),
      quantity: z.coerce.number().positive().max(99_999),
      responsible: nullableText,
      notes: nullableText,
      deliveredAt: z.coerce.date(),
    })).mutation(async ({ ctx, input }) => {
      const result = await deliverQuoteItem(input);
      const quote = await getQuote(input.quoteId);
      await log(ctx, { action: "stock.delivery", entityType: "stock", entityId: input.quoteItemId, summary: `Registrou entrega de ${input.quantity} item(ns) do orçamento #${quote?.quoteNumber ?? input.quoteId}${quote?.clientName ? ` (${quote.clientName})` : ""}`, details: { responsavel: input.responsible ?? null } });
      return result;
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
      document: nullableText,
      address: nullableText,
      phone: nullableText,
      email: z.string().email().nullable().optional().or(z.literal("")),
      pixKey: nullableText,
      pixRecipient: nullableText,
      pixCity: z.string().trim().max(60).nullable().optional(),
      defaultPixDiscountMode: z.enum(["percentage", "fixed"]),
      defaultPixDiscountValue: money,
      defaultInstallments: z.coerce.number().int().min(1).max(24),
      alertThresholdDays: z.coerce.number().int().min(1).max(60),
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
      });
      const changes = changedFields(before as Record<string, unknown>, saved as Record<string, unknown>, ["companyName", "tradingName", "logoUrl", "document", "address", "phone", "email", "pixKey", "pixRecipient", "pixCity", "defaultPixDiscountMode", "defaultPixDiscountValue", "defaultInstallments", "alertThresholdDays", "defaultTerms"]);
      if (Object.keys(changes).length) await log(ctx, { action: "settings.update", entityType: "settings", summary: `Alterou as configurações da loja: ${Object.keys(changes).join(", ")}`, details: changes });
      return saved;
    }),
  }),
  templates: router({
    list: protectedProcedure.query(listMessageTemplates),
    save: protectedProcedure.input(z.object({ id: z.number().int().positive().optional(), event: z.enum(["quote_sent", "quote_approved", "quote_expiring", "quote_expired", "payment_due", "payment_overdue", "delivery_scheduled", "delivery_completed"]), name: z.string().trim().min(1).max(160), subject: z.string().trim().max(240).nullable().optional(), body: z.string().trim().min(1).max(12000), active: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
      const result = await saveMessageTemplate(input);
      await log(ctx, { action: "message.template", entityType: "message", entityId: result.id, summary: `Salvou o modelo de mensagem "${input.name}" (${MESSAGE_EVENT_LABELS[input.event]})` });
      return result;
    }),
  }),
  messages: router({
    pending: protectedProcedure.query(() => pendingMessages()),
    forQuote: protectedProcedure.input(z.object({ quoteId: z.number().int().positive(), event: messageEvent })).query(async ({ input }) => {
      try {
        return await messageForQuote(input.quoteId, input.event);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível montar a mensagem." });
      }
    }),
    // O envio acontece no WhatsApp ou no e-mail da própria pessoa; aqui só
    // registramos que a mensagem foi aberta para envio.
    logSent: protectedProcedure.input(z.object({ event: messageEvent, channel: z.enum(["whatsapp", "email", "copy"]), clientName: z.string().trim().max(240), quoteId: z.number().int().positive().nullable().optional(), receivableId: z.number().int().positive().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const channel = { whatsapp: "WhatsApp", email: "e-mail", copy: "cópia manual" }[input.channel];
      await log(ctx, { action: `message.${input.channel}`, entityType: "message", entityId: input.receivableId ?? input.quoteId ?? null, summary: `Enviou "${MESSAGE_EVENT_LABELS[input.event]}" para ${input.clientName || "cliente sem nome"} por ${channel}`, details: { quoteId: input.quoteId ?? null, receivableId: input.receivableId ?? null } });
      return { logged: true } as const;
    }),
  }),
  activity: router({
    list: adminProcedure.input(z.object({
      entityType: z.enum(["quote", "product", "finance", "stock", "settings", "user", "auth", "backup", "message", "customer"]).optional(),
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
      await log(ctx, { action: "backup.import", entityType: "backup", summary: `Restaurou um backup${input.replace ? " substituindo os dados atuais" : ""}`, details: { exportadoEm: input.data.exportedAt ?? null } });
      return result;
    }),
  }),
});
