import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { saveLocalImage } from "../localStorage";
import {
  createQuote,
  dashboardMetrics,
  deleteProduct,
  deleteQuote,
  exportBackup,
  getQuote,
  getSettings,
  getPickingList,
  importBackup,
  listClients,
  listProducts,
  listQuotes,
  saveClient,
  saveProduct,
  saveQuote,
  saveSettings,
} from "../quoteDb";
import { approvedFulfillments, deliverQuoteItem, inventoryOverview, recordStockMovement } from "../stockDb";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

const nullableText = z.string().trim().max(2000).nullable().optional();
const money = z.coerce.number().min(0).max(99_999_999).default(0);
const imageLocation = z.string().trim().refine(
  (value) => value.startsWith("/uploads/"),
  "Envie uma imagem local válida",
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
  unit: z.string().trim().min(1).max(16).default("UN"),
  supplierName: z.string().trim().max(240).nullable().optional().or(z.literal("")),
  unitPrice: money,
  reorderPoint: money,
  active: z.boolean().default(true),
});

const quoteItemInput = z.object({
  id: z.number().int().positive().optional(),
  productId: z.number().int().positive().nullable().optional(),
  code: z.string().trim().max(64).default(""),
  shortDescription: z.string().trim().min(1, "Informe a descrição do item").max(512),
  imageUrl: nullableText,
  unit: z.string().trim().min(1).max(16).default("UN"),
  quantity: z.coerce.number().positive("A quantidade deve ser maior que zero").max(99999),
  unitPrice: money,
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
    save: protectedProcedure.input(clientInput).mutation(({ input }) => saveClient({ ...input, email: input.email || null })),
  }),
  product: router({
    list: protectedProcedure.input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listProducts(input?.search)),
    save: protectedProcedure.input(productInput).mutation(({ input }) => saveProduct({ ...input, imageUrl: input.imageUrl || null })),
    archive: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteProduct(input.id)),
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
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input }) => getQuote(input.id)),
    create: protectedProcedure.mutation(createQuote),
    save: protectedProcedure.input(quoteInput).mutation(({ input }) => saveQuote(input)),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteQuote(input.id)),
    duplicate: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const source = await getQuote(input.id);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      const fresh = await createQuote();
      if (!fresh) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a cópia do orçamento" });
      return saveQuote({
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
      });
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
    })).mutation(({ input }) => recordStockMovement(input)),
    deliver: protectedProcedure.input(z.object({
      quoteId: z.number().int().positive(),
      quoteItemId: z.number().int().positive(),
      quantity: z.coerce.number().positive().max(99_999),
      responsible: nullableText,
      notes: nullableText,
      deliveredAt: z.coerce.date(),
    })).mutation(({ input }) => deliverQuoteItem(input)),
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
      defaultPixDiscountMode: z.enum(["percentage", "fixed"]),
      defaultPixDiscountValue: money,
      defaultInstallments: z.coerce.number().int().min(1).max(24),
      alertThresholdDays: z.coerce.number().int().min(1).max(60),
      defaultTerms: nullableText,
    })).mutation(({ input }) => saveSettings({
      ...input,
      logoUrl: input.logoUrl || null,
      document: input.document || null,
      address: input.address || null,
      phone: input.phone || null,
      email: input.email || null,
      pixKey: input.pixKey || null,
      pixRecipient: input.pixRecipient || null,
      defaultTerms: input.defaultTerms || null,
      defaultPixDiscountValue: input.defaultPixDiscountValue.toFixed(2),
    })),
  }),
  backup: router({
    export: adminProcedure.query(exportBackup),
    import: adminProcedure.input(z.object({
      data: z.record(z.string(), z.unknown()),
      replace: z.boolean().default(true),
    })).mutation(({ input }) => {
      if (input.data.format !== "luminno-backup" || input.data.version !== 1 || !input.data.data) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este arquivo não é um backup Luminno válido" });
      }
      return importBackup({ data: input.data.data as Record<string, unknown>, replace: input.replace });
    }),
  }),
});
