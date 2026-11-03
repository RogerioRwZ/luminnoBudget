import { z } from "zod";
import { areaProcedure, router } from "../_core/trpc";
import { recordActivity } from "../activityLog";
import { createLoan, extendLoan, listLoans, settleLoan } from "../loansDb";
import { BORROWER_KINDS } from "../../shared/loans";
import { isCentQuantity } from "../../shared/stock";
import { plural } from "../../shared/plural";

const quantity = z.coerce.number().refine((value) => value > 0 && value <= 99_999 && isCentQuantity(value), "Informe uma quantidade válida, com até 2 casas decimais");
const settleQuantity = z.coerce.number().min(0).max(99_999).refine(isCentQuantity, "Use no máximo 2 casas decimais").default(0);
const text = z.string().trim().max(2000).nullable().optional();

export const loansRouter = router({
  list: areaProcedure("loans").query(() => listLoans()),
  create: areaProcedure("loans").input(z.object({
    borrowerName: z.string().trim().min(1, "Informe com quem a peça vai ficar").max(240),
    borrowerKind: z.enum(BORROWER_KINDS),
    phone: z.string().trim().max(40).nullable().optional(),
    quoteId: z.number().int().positive().nullable().optional(),
    notes: text,
    dueDate: z.coerce.date(),
    responsible: z.string().trim().max(240).nullable().optional(),
    items: z.array(z.object({ productId: z.number().int().positive(), quantity })).min(1, "Inclua ao menos um produto").max(50),
  })).mutation(async ({ ctx, input }) => {
    const loan = await createLoan(input, ctx.user.id);
    await recordActivity(ctx.user, { action: "loan.create", entityType: "stock", entityId: loan.id, summary: `Emprestou ${plural(loan.items.length, "item", "itens")} a ${loan.borrowerName} (empréstimo #${loan.id}): ${loan.items.map((item) => `${item.quantity} × ${item.shortDescription}`).join(", ")}`.slice(0, 500) }, ctx.req);
    return loan;
  }),
  settle: areaProcedure("loans").input(z.object({
    loanId: z.number().int().positive(),
    lines: z.array(z.object({ itemId: z.number().int().positive(), returned: settleQuantity, sold: settleQuantity, lost: settleQuantity })).min(1).max(50),
    quoteNumber: z.number().int().positive().nullable().optional(),
    notes: text,
    responsible: z.string().trim().max(240).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const loan = await settleLoan(input);
    const sum = (key: "returned" | "sold" | "lost") => input.lines.reduce((total, line) => total + line[key], 0);
    const parts = [sum("returned") ? `${sum("returned")} devolvida(s)` : "", sum("sold") ? `${sum("sold")} vendida(s)` : "", sum("lost") ? `${sum("lost")} perdida(s)` : ""].filter(Boolean);
    await recordActivity(ctx.user, { action: "loan.settle", entityType: "stock", entityId: loan.id, summary: `Acertou o empréstimo #${loan.id} de ${loan.borrowerName}: ${parts.join(", ")}${loan.open ? "" : " (encerrado)"}` }, ctx.req);
    return loan;
  }),
  extend: areaProcedure("loans").input(z.object({ loanId: z.number().int().positive(), dueDate: z.coerce.date() })).mutation(async ({ ctx, input }) => {
    const loan = await extendLoan(input);
    if (loan) await recordActivity(ctx.user, { action: "loan.extend", entityType: "stock", entityId: loan.id, summary: `Prorrogou o empréstimo #${loan.id} de ${loan.borrowerName} até ${new Intl.DateTimeFormat("pt-BR").format(input.dueDate)}` }, ctx.req);
    return loan;
  }),
});
