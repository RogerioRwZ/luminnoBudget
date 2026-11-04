import { z } from "zod";
import { areaProcedure, router } from "../_core/trpc";
import { afterSalesItems, afterSalesReport, afterSalesSales, createAfterSalesCase, listAfterSalesCases, updateAfterSalesCase } from "../afterSalesDb";
import { formatActivityMoney as brl, recordActivity } from "../activityLog";
import { AFTER_SALES_REASONS, AFTER_SALES_REASON_LABELS, AFTER_SALES_STATUSES, AFTER_SALES_STATUS_LABELS, AFTER_SALES_TYPES, AFTER_SALES_TYPE_LABELS } from "../../shared/afterSales";
import { isCentQuantity } from "../../shared/stock";

const text = z.string().trim().max(2000).nullable().optional();
const periodInput = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((range) => range.to > range.from && range.to.getTime() - range.from.getTime() <= 367 * 24 * 60 * 60_000, "Escolha um período de até um ano.");

export const afterSalesRouter = router({
  list: areaProcedure("aftersales").input(z.object({ quoteId: z.number().int().positive().optional() }).optional()).query(({ input }) => listAfterSalesCases(input ?? {})),
  sales: areaProcedure("aftersales").query(() => afterSalesSales()),
  items: areaProcedure("aftersales").input(z.object({ quoteId: z.number().int().positive() })).query(({ input }) => afterSalesItems(input.quoteId)),
  report: areaProcedure("aftersales").input(periodInput).query(({ input }) => afterSalesReport(input)),
  create: areaProcedure("aftersales").input(z.object({
    quoteId: z.number().int().positive(),
    quoteItemId: z.number().int().positive(),
    type: z.enum(AFTER_SALES_TYPES),
    reason: z.enum(AFTER_SALES_REASONS),
    quantity: z.coerce.number().refine((value) => value > 0 && value <= 99_999 && isCentQuantity(value), "Informe uma quantidade válida, com até 2 casas decimais"),
    dueDate: z.coerce.date(),
    description: text,
  })).mutation(async ({ ctx, input }) => {
    const created = (await createAfterSalesCase(input, ctx.user.id))!;
    await recordActivity(ctx.user, {
      action: `aftersales.${input.type}`,
      entityType: "aftersales",
      entityId: created.id,
      summary: `Abriu ${AFTER_SALES_TYPE_LABELS[input.type].toLowerCase()} #${created.id}: ${created.quantity} × ${created.productDescription} do orçamento #${created.quoteNumber} (${created.clientName}) — ${AFTER_SALES_REASON_LABELS[input.reason].toLowerCase()}`,
    }, ctx.req);
    return created;
  }),
  update: areaProcedure("aftersales").input(z.object({
    id: z.number().int().positive(),
    status: z.enum(AFTER_SALES_STATUSES),
    dueDate: z.coerce.date(),
    description: text,
    resolution: text,
    refundAmount: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
    restock: z.boolean().optional(),
    replacement: z.boolean().optional(),
    responsible: z.string().trim().max(240).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const { before, after, restocked, replaced, undoneRestock, undoneReplacement } = await updateAfterSalesCase(input);
    const notes = [
      before.status !== after.status ? `${AFTER_SALES_STATUS_LABELS[before.status].toLowerCase()} → ${AFTER_SALES_STATUS_LABELS[after.status].toLowerCase()}` : "",
      restocked ? `${after.quantity} de volta ao estoque` : "",
      replaced ? `${after.quantity} peça(s) nova(s) baixada(s) do estoque` : "",
      undoneRestock ? `${after.quantity} devolvida(s) saíram do estoque` : "",
      undoneReplacement ? `${after.quantity} peça(s) nova(s) voltaram ao estoque` : "",
      after.refundAmount && after.refundAmount !== before.refundAmount ? `reembolso de ${brl(after.refundAmount)}` : "",
    ].filter(Boolean);
    await recordActivity(ctx.user, {
      action: `aftersales.${after.status}`,
      entityType: "aftersales",
      entityId: after.id,
      summary: `Atualizou o pós-venda #${after.id} (${after.productDescription}, ${after.clientName})${notes.length ? `: ${notes.join(", ")}` : ""}`,
      details: { solucao: after.resolution },
    }, ctx.req);
    return after;
  }),
});
