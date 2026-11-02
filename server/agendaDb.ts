import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import { appointments, quotes } from "../drizzle/schema";
import { getDb } from "./db";

export type AppointmentType = "delivery" | "technical_visit" | "installation";
export type AppointmentStatus = "scheduled" | "done" | "cancelled";
export type AppointmentInput = {
  id?: number;
  type: AppointmentType;
  quoteId?: number | null;
  clientId?: number | null;
  clientName: string;
  phone?: string | null;
  address?: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  responsible?: string | null;
  notes?: string | null;
};

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

export async function listAppointments(range: { from: Date; to: Date }) {
  const db = await database();
  const rows = await db
    .select({ appointment: appointments, quoteNumber: quotes.quoteNumber })
    .from(appointments)
    .leftJoin(quotes, eq(quotes.id, appointments.quoteId))
    .where(and(gte(appointments.scheduledAt, range.from), lt(appointments.scheduledAt, range.to)))
    .orderBy(asc(appointments.scheduledAt), asc(appointments.id));
  return rows.map((row) => ({ ...row.appointment, quoteNumber: row.quoteNumber ?? null }));
}

export async function upcomingAppointments(limit = 5) {
  const db = await database();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ appointment: appointments, quoteNumber: quotes.quoteNumber })
    .from(appointments)
    .leftJoin(quotes, eq(quotes.id, appointments.quoteId))
    .where(and(gte(appointments.scheduledAt, startOfToday), eq(appointments.status, "scheduled")))
    .orderBy(asc(appointments.scheduledAt))
    .limit(limit);
  return rows.map((row) => ({ ...row.appointment, quoteNumber: row.quoteNumber ?? null }));
}

export async function getAppointment(id: number) {
  const db = await database();
  return (await db.select().from(appointments).where(eq(appointments.id, id)).limit(1))[0] ?? null;
}

// Outros compromissos do mesmo responsável que se sobrepõem a este horário.
export async function findConflicts(input: { id?: number; responsible?: string | null; scheduledAt: Date; durationMinutes: number }) {
  const responsible = input.responsible?.trim();
  if (!responsible) return [];
  const db = await database();
  const start = input.scheduledAt.getTime();
  const end = start + input.durationMinutes * 60_000;
  const dayStart = new Date(start - 24 * 60 * 60_000);
  const rows = await db.select().from(appointments).where(and(
    eq(appointments.responsible, responsible),
    eq(appointments.status, "scheduled"),
    gte(appointments.scheduledAt, dayStart),
    lt(appointments.scheduledAt, new Date(end)),
    input.id ? ne(appointments.id, input.id) : undefined,
  ));
  return rows.filter((row) => row.scheduledAt.getTime() + row.durationMinutes * 60_000 > start);
}

export async function saveAppointment(input: AppointmentInput, userId: number) {
  const db = await database();
  if (input.quoteId) {
    const quote = (await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, input.quoteId)).limit(1))[0];
    if (!quote) throw new Error("Orçamento não encontrado.");
  }
  const values = {
    type: input.type,
    quoteId: input.quoteId || null,
    clientId: input.clientId || null,
    clientName: input.clientName,
    phone: input.phone || null,
    address: input.address || null,
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes,
    responsible: input.responsible?.trim() || null,
    notes: input.notes || null,
  };
  if (input.id) {
    const existing = await getAppointment(input.id);
    if (!existing) throw new Error("Agendamento não encontrado. Ele pode ter sido excluído.");
    await db.update(appointments).set(values).where(eq(appointments.id, input.id));
    return (await getAppointment(input.id))!;
  }
  const inserted = await db.insert(appointments).values({ ...values, createdByUserId: userId }).$returningId();
  return (await getAppointment(inserted[0]!.id))!;
}

export async function setAppointmentStatus(id: number, status: AppointmentStatus) {
  const db = await database();
  const existing = await getAppointment(id);
  if (!existing) throw new Error("Agendamento não encontrado.");
  await db.update(appointments).set({ status }).where(eq(appointments.id, id));
  return (await getAppointment(id))!;
}

export async function deleteAppointment(id: number) {
  const db = await database();
  const existing = await getAppointment(id);
  if (!existing) throw new Error("Agendamento não encontrado.");
  await db.delete(appointments).where(eq(appointments.id, id));
  return existing;
}
