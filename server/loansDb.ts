import { desc, eq, inArray, sql } from "drizzle-orm";
import { products, quotes, stockLoanItems, stockLoans } from "../drizzle/schema";
import { loanItemPending, loanStatus, validateSettlement, type BorrowerKind } from "../shared/loans";
import { toNumber } from "../shared/quote";
import { getDb, LOCKED_READS } from "./db";
import { moveStock } from "./stockDb";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

const money = (value: number) => value.toFixed(2);

export type LoanRow = Awaited<ReturnType<typeof listLoans>>[number];

export async function listLoans(filter: { ids?: number[] } = {}, now = new Date()) {
  const db = await database();
  const loans = await db
    .select({ loan: stockLoans, quoteNumber: quotes.quoteNumber })
    .from(stockLoans)
    .leftJoin(quotes, eq(stockLoans.quoteId, quotes.id))
    .where(filter.ids ? inArray(stockLoans.id, filter.ids.length ? filter.ids : [0]) : undefined)
    .orderBy(desc(stockLoans.loanedAt), desc(stockLoans.id));
  const loanIds = loans.map((row) => row.loan.id);
  const items = loanIds.length
    ? await db
      .select({ item: stockLoanItems, code: products.code, unit: products.unit })
      .from(stockLoanItems)
      .leftJoin(products, eq(stockLoanItems.productId, products.id))
      .where(inArray(stockLoanItems.loanId, loanIds))
    : [];
  const rows = loans.map(({ loan, quoteNumber }) => {
    const loanItems = items
      .filter((row) => row.item.loanId === loan.id)
      .map(({ item, code, unit }) => {
        const quantities = { quantity: toNumber(item.quantity), returnedQuantity: toNumber(item.returnedQuantity), soldQuantity: toNumber(item.soldQuantity), lostQuantity: toNumber(item.lostQuantity) };
        return { ...item, ...quantities, code: code ?? "", unit: unit ?? "UN", pending: loanItemPending(quantities) };
      });
    return { ...loan, quoteNumber, items: loanItems, ...loanStatus(loanItems, loan.dueDate, now) };
  });
  // Abertos primeiro, pelo prazo; depois os encerrados.
  return rows.sort((first, second) => Number(second.open) - Number(first.open) || (first.open ? first.dueDate.getTime() - second.dueDate.getTime() : 0));
}

export async function getLoan(id: number) {
  return (await listLoans({ ids: [id] }))[0] ?? null;
}

export async function createLoan(input: {
  borrowerName: string;
  borrowerKind: BorrowerKind;
  phone?: string | null;
  quoteId?: number | null;
  notes?: string | null;
  dueDate: Date;
  items: Array<{ productId: number; quantity: number }>;
  responsible?: string | null;
}, userId: number) {
  const db = await database();
  const productIds = Array.from(new Set(input.items.map((item) => item.productId)));
  if (productIds.length !== input.items.length) throw new Error("O mesmo produto aparece duas vezes: some as quantidades numa linha só.");
  const productRows = await db.select({ id: products.id, shortDescription: products.shortDescription }).from(products).where(inArray(products.id, productIds));
  const names = new Map(productRows.map((row) => [row.id, row.shortDescription]));
  const loanId = await db.transaction(async (tx) => {
    const inserted = await tx.insert(stockLoans).values({
      borrowerName: input.borrowerName,
      borrowerKind: input.borrowerKind,
      phone: input.phone || null,
      quoteId: input.quoteId ?? null,
      notes: input.notes || null,
      dueDate: input.dueDate,
      createdByUserId: userId,
    }).$returningId();
    const id = inserted[0]!.id;
    for (const item of input.items) {
      const shortDescription = names.get(item.productId);
      if (!shortDescription) throw new Error("Produto não encontrado.");
      // A saída respeita as reservas: não empresta o que já foi vendido.
      await moveStock(tx, { productId: item.productId, type: "loan_out", quantity: item.quantity, occurredAt: new Date(), responsible: input.responsible || null, notes: `Empréstimo #${id} para ${input.borrowerName}`, quoteId: input.quoteId ?? null, clientName: input.borrowerName });
      await tx.insert(stockLoanItems).values({ loanId: id, productId: item.productId, shortDescription, quantity: money(item.quantity) });
    }
    return id;
  }, LOCKED_READS);
  return (await getLoan(loanId))!;
}

// Acerto: o que volta e o que virou venda entram de novo no saldo (a venda
// segue o caminho normal do orçamento: reserva e retirada); o que se perdeu
// já saiu do estoque no empréstimo e só fica registrado.
export async function settleLoan(input: {
  loanId: number;
  lines: Array<{ itemId: number; returned: number; sold: number; lost: number }>;
  // Número do orçamento da venda (quem é da expedição não abre orçamentos).
  quoteNumber?: number | null;
  notes?: string | null;
  responsible?: string | null;
}) {
  const db = await database();
  await db.transaction(async (tx) => {
    // A trava vem antes da conferência: dois acertos ao mesmo tempo não podem
    // devolver a mesma peça duas vezes.
    await tx.execute(sql`SELECT id FROM ${stockLoans} WHERE ${eq(stockLoans.id, input.loanId)} FOR UPDATE`);
    const loan = await getLoan(input.loanId);
    if (!loan) throw new Error("Empréstimo não encontrado.");
    const lines = input.lines.filter((line) => line.returned > 0 || line.sold > 0 || line.lost > 0);
    if (!lines.length) throw new Error("Informe o que voltou, o que foi vendido ou o que se perdeu.");
    for (const line of lines) {
      const item = loan.items.find((entry) => entry.id === line.itemId);
      if (!item) throw new Error("Item não encontrado neste empréstimo.");
      const problem = validateSettlement(item, line);
      if (problem) throw new Error(`${item.shortDescription}: ${problem}`);
    }
    const quote = input.quoteNumber ? (await db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber }).from(quotes).where(eq(quotes.quoteNumber, input.quoteNumber)).limit(1))[0] : undefined;
    if (input.quoteNumber && !quote) throw new Error(`Orçamento #${input.quoteNumber} não encontrado.`);
    const quoteNumber = quote?.quoteNumber;
    for (const line of lines) {
      const item = loan.items.find((entry) => entry.id === line.itemId)!;
      const base = { productId: item.productId, occurredAt: new Date(), responsible: input.responsible || null, clientName: loan.borrowerName };
      if (line.returned > 0) await moveStock(tx, { ...base, type: "loan_return", quantity: line.returned, notes: `Devolução do empréstimo #${loan.id}` });
      if (line.sold > 0) await moveStock(tx, { ...base, type: "loan_return", quantity: line.sold, quoteId: quote?.id ?? null, notes: `Empréstimo #${loan.id} virou venda${quoteNumber ? ` (orçamento #${quoteNumber})` : ""}: volta ao saldo para o pedido` });
      await tx.update(stockLoanItems).set({
        returnedQuantity: money(item.returnedQuantity + line.returned),
        soldQuantity: money(item.soldQuantity + line.sold),
        lostQuantity: money(item.lostQuantity + line.lost),
      }).where(eq(stockLoanItems.id, item.id));
    }
    const notes = [loan.notes, input.notes?.trim()].filter(Boolean).join("\n");
    const stillOpen = loan.items.some((item) => {
      const line = lines.find((entry) => entry.itemId === item.id);
      return item.pending - (line ? line.returned + line.sold + line.lost : 0) > 0.001;
    });
    await tx.update(stockLoans).set({
      notes: notes || null,
      ...(quote ? { quoteId: quote.id } : {}),
      closedAt: stillOpen ? null : new Date(),
    }).where(eq(stockLoans.id, loan.id));
  }, LOCKED_READS);
  return (await getLoan(input.loanId))!;
}

export async function extendLoan(input: { loanId: number; dueDate: Date }) {
  const db = await database();
  await db.update(stockLoans).set({ dueDate: input.dueDate }).where(eq(stockLoans.id, input.loanId));
  return getLoan(input.loanId);
}

// Quantidade emprestada (ainda fora) por produto, para a tela de Estoque.
export async function loanedByProduct() {
  const open = (await listLoans()).filter((loan) => loan.open);
  const totals = new Map<number, number>();
  for (const loan of open) for (const item of loan.items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.pending);
  return totals;
}

// Para o Resumo do dia: abertos com devolução até hoje.
export async function loansDue(now = new Date()) {
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return (await listLoans({}, now))
    .filter((loan) => loan.open && loan.dueDate < endOfDay)
    .map((loan) => ({ id: loan.id, borrowerName: loan.borrowerName, pending: loan.pending, dueDate: loan.dueDate, overdue: loan.overdue }));
}
