import { desc, eq, inArray } from "drizzle-orm";
import { clients, messageTemplates, quotes } from "../drizzle/schema";
import { DEFAULT_MESSAGE_TEMPLATES, MESSAGE_EVENT_LABELS, daysPhrase, renderMessage, type MessageEvent, type MessageVariables } from "../shared/messages";
import { buildPixPayload } from "../shared/pix";
import { getExpirationAlerts } from "../shared/quoteAlerts";
import { normalizeWhatsAppPhone } from "../shared/whatsapp";
import { getDb } from "./db";
import { financeOverview } from "./financeDb";
import { getQuote, getSettings, listQuotes } from "./quoteDb";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

type Settings = Awaited<ReturnType<typeof getSettings>>;
const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const date = (value: Date | string | null | undefined) => (value ? new Intl.DateTimeFormat("pt-BR").format(new Date(value)) : "");
const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

export function pixFor(settings: Settings, amount: number, txid: string, description?: string) {
  if (!settings.pixKey) return "";
  try {
    return buildPixPayload({ key: settings.pixKey, name: settings.pixRecipient || settings.companyName, city: settings.pixCity || "BRASIL", amount, txid, description });
  } catch {
    return "";
  }
}

// Modelo ativo mais recente do evento; sem modelo, usa o texto padrão.
async function templatesByEvent() {
  const db = await database();
  const rows = await db.select().from(messageTemplates).where(eq(messageTemplates.active, true)).orderBy(desc(messageTemplates.updatedAt), desc(messageTemplates.id));
  const map = new Map<MessageEvent, { subject: string; body: string }>();
  for (const row of rows) if (!map.has(row.event)) map.set(row.event, { subject: row.subject || DEFAULT_MESSAGE_TEMPLATES[row.event].subject, body: row.body });
  return (event: MessageEvent) => map.get(event) ?? DEFAULT_MESSAGE_TEMPLATES[event];
}

function storeVariables(settings: Settings): MessageVariables {
  return { loja: settings.tradingName || settings.companyName, telefone_loja: settings.phone, chave_pix: settings.pixKey };
}

export type PreparedMessage = {
  key: string;
  event: MessageEvent;
  eventLabel: string;
  quoteId: number | null;
  receivableId: number | null;
  clientName: string;
  phone: string;
  email: string;
  subject: string;
  body: string;
  referenceDate: Date | null;
  amount: number;
  pix: string;
};

function prepare(template: { subject: string; body: string }, base: Omit<PreparedMessage, "subject" | "body" | "eventLabel">, variables: MessageVariables): PreparedMessage {
  return { ...base, eventLabel: MESSAGE_EVENT_LABELS[base.event], subject: renderMessage(template.subject, variables), body: renderMessage(template.body, variables) };
}

async function contactsFor(clientIds: number[]) {
  if (!clientIds.length) return new Map<number, { phone: string | null; email: string | null }>();
  const db = await database();
  const rows = await db.select({ id: clients.id, phone: clients.phone, email: clients.email }).from(clients).where(inArray(clients.id, clientIds));
  return new Map(rows.map((row) => [row.id, { phone: row.phone, email: row.email }]));
}

type QuoteForMessage = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

function quoteMessage(event: MessageEvent, quote: QuoteForMessage, settings: Settings, template: { subject: string; body: string }, contact?: { phone: string | null; email: string | null }) {
  const daysRemaining = quote.validUntil ? Math.round((startOfDay(new Date(quote.validUntil)) - startOfDay(new Date())) / DAY) : null;
  const pix = event === "quote_sent" ? pixFor(settings, quote.summary.pixTotal, `ORC${quote.quoteNumber}`, `Orcamento ${quote.quoteNumber}`) : "";
  return prepare(template, {
    key: `${event}-${quote.id}`,
    event,
    quoteId: quote.id,
    receivableId: null,
    clientName: quote.clientName,
    phone: normalizeWhatsAppPhone(quote.phone || contact?.phone || ""),
    email: contact?.email || "",
    referenceDate: quote.validUntil ? new Date(quote.validUntil) : null,
    amount: quote.summary.total,
    pix,
  }, {
    ...storeVariables(settings),
    cliente: quote.clientName,
    numero: quote.quoteNumber,
    valor: currency(quote.summary.total),
    validade: date(quote.validUntil),
    vencimento: date(quote.validUntil),
    dias: daysRemaining === null ? "" : daysPhrase(daysRemaining),
    total_pix: quote.summary.pixDiscountAmount > 0 ? currency(quote.summary.pixTotal) : "",
    pix,
  });
}

type Receivable = Awaited<ReturnType<typeof financeOverview>>["receivables"][number];

function receivableMessage(receivable: Receivable, settings: Settings, template: (event: MessageEvent) => { subject: string; body: string }, contact: { phone: string; email: string }) {
  // Decide pela data: uma parcela paga em parte e já vencida tem status
  // "partial" (não "overdue"), mas continua atrasada para o cliente.
  const daysRemaining = Math.round((startOfDay(new Date(receivable.dueDate)) - startOfDay(new Date())) / DAY);
  const event: MessageEvent = receivable.overdue || daysRemaining < 0 ? "payment_overdue" : "payment_due";
  const pix = pixFor(settings, receivable.remainingAmount, `P${receivable.id}`, receivable.quoteNumber ? `Orcamento ${receivable.quoteNumber} parcela ${receivable.installmentNumber}` : undefined);
  return prepare(template(event), {
    key: `${event}-${receivable.id}`,
    event,
    quoteId: receivable.quoteId,
    receivableId: receivable.id,
    clientName: receivable.clientName,
    phone: normalizeWhatsAppPhone(contact.phone),
    email: contact.email,
    referenceDate: new Date(receivable.dueDate),
    amount: receivable.remainingAmount,
    pix,
  }, {
    ...storeVariables(settings),
    cliente: receivable.clientName,
    numero: receivable.quoteNumber ?? receivable.description,
    valor: currency(receivable.remainingAmount),
    vencimento: date(receivable.dueDate),
    parcela: `${receivable.installmentNumber}/${receivable.installmentCount}`,
    dias: daysPhrase(daysRemaining),
    pix,
  });
}

async function receivableContacts(rows: Receivable[]) {
  const clientContacts = await contactsFor(Array.from(new Set(rows.map((row) => row.clientId).filter((id): id is number => Boolean(id)))));
  const quoteIds = Array.from(new Set(rows.map((row) => row.quoteId).filter((id): id is number => Boolean(id))));
  const db = await database();
  const quotePhones = quoteIds.length ? new Map((await db.select({ id: quotes.id, phone: quotes.phone }).from(quotes).where(inArray(quotes.id, quoteIds))).map((row) => [row.id, row.phone])) : new Map<number, string | null>();
  return (row: Receivable) => {
    const contact = row.clientId ? clientContacts.get(row.clientId) : undefined;
    return { phone: contact?.phone || (row.quoteId ? quotePhones.get(row.quoteId) : "") || "", email: contact?.email || "" };
  };
}

// Lembretes que fazem sentido enviar hoje: propostas vencendo/vencidas e
// parcelas a vencer (dentro do prazo de alerta) ou em atraso.
export async function pendingMessages(now = new Date()) {
  const [settings, allQuotes, finance, template] = await Promise.all([getSettings(), listQuotes(), financeOverview(), templatesByEvent()]);
  const threshold = settings.alertThresholdDays;
  const quoteContacts = await contactsFor(Array.from(new Set(allQuotes.map((quote) => quote.clientId).filter((id): id is number => Boolean(id)))));
  const quoteById = new Map(allQuotes.map((quote) => [quote.id, quote]));
  const messages: PreparedMessage[] = [];
  for (const alert of getExpirationAlerts(allQuotes, now, threshold)) {
    const quote = quoteById.get(alert.id)!;
    const event: MessageEvent = alert.daysRemaining < 0 ? "quote_expired" : "quote_expiring";
    messages.push(quoteMessage(event, quote as QuoteForMessage, settings, template(event), quote.clientId ? quoteContacts.get(quote.clientId) : undefined));
  }
  const openReceivables = finance.receivables.filter((row) => row.status !== "cancelled" && row.status !== "paid" && row.remainingAmount > 0
    && (row.overdue || (startOfDay(new Date(row.dueDate)) - startOfDay(now)) / DAY <= threshold));
  const contactOf = await receivableContacts(openReceivables);
  for (const row of openReceivables) messages.push(receivableMessage(row, settings, template, contactOf(row)));
  const priority: Record<MessageEvent, number> = { payment_overdue: 0, quote_expired: 1, payment_due: 2, quote_expiring: 3, quote_sent: 4, quote_approved: 5, delivery_scheduled: 6, delivery_completed: 7 };
  return messages.sort((first, second) => priority[first.event] - priority[second.event] || (first.referenceDate?.getTime() ?? 0) - (second.referenceDate?.getTime() ?? 0));
}

export async function messageForQuote(quoteId: number, event: MessageEvent) {
  if (event === "payment_due" || event === "payment_overdue") throw new Error("Use a mensagem da parcela para cobranças.");
  const [quote, settings, template] = await Promise.all([getQuote(quoteId), getSettings(), templatesByEvent()]);
  if (!quote) throw new Error("Orçamento não encontrado.");
  const contact = quote.clientId ? (await contactsFor([quote.clientId])).get(quote.clientId) : undefined;
  return quoteMessage(event, quote, settings, template(event), contact);
}

export async function messageForReceivable(receivableId: number) {
  const [settings, finance, template] = await Promise.all([getSettings(), financeOverview(), templatesByEvent()]);
  const receivable = finance.receivables.find((row) => row.id === receivableId);
  if (!receivable) throw new Error("Cobrança não encontrada.");
  const contactOf = await receivableContacts([receivable]);
  return receivableMessage(receivable, settings, template, contactOf(receivable));
}
