import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { appointments } from "../drizzle/schema";
import { getDb } from "./db";
import { deleteAppointment, findConflicts, listAppointments, saveAppointment, setAppointmentStatus, upcomingAppointments } from "./agendaDb";

const ids: number[] = [];
afterEach(async () => {
  const db = await getDb();
  if (db && ids.length) await db.delete(appointments).where(inArray(appointments.id, ids));
  ids.length = 0;
});

describe("agenda", () => {
  it("agenda, lista na semana, aponta conflito do mesmo responsável e muda status", async () => {
    const responsible = `Equipe ${Date.now()}`;
    const at = new Date(2031, 2, 10, 9, 0);
    const first = await saveAppointment({ type: "installation", clientName: "Cliente A", scheduledAt: at, durationMinutes: 120, responsible }, 0);
    ids.push(first.id);
    const overlapping = { responsible, scheduledAt: new Date(2031, 2, 10, 10, 30), durationMinutes: 60 };
    expect((await findConflicts(overlapping)).map((row) => row.id)).toEqual([first.id]);
    expect(await findConflicts({ ...overlapping, scheduledAt: new Date(2031, 2, 10, 11, 0) })).toEqual([]);
    expect(await findConflicts({ ...overlapping, id: first.id })).toEqual([]);

    const week = await listAppointments({ from: new Date(2031, 2, 10), to: new Date(2031, 2, 17) });
    expect(week.find((row) => row.id === first.id)).toMatchObject({ type: "installation", clientName: "Cliente A", quoteNumber: null });

    await setAppointmentStatus(first.id, "cancelled");
    expect(await findConflicts(overlapping)).toEqual([]);
    expect((await upcomingAppointments(50)).some((row) => row.id === first.id)).toBe(false);

    await deleteAppointment(first.id);
    await expect(setAppointmentStatus(first.id, "done")).rejects.toThrow(/não encontrado/);
  });

  it("recusa orçamento inexistente", async () => {
    await expect(saveAppointment({ type: "delivery", quoteId: 999_999_999, clientName: "X", scheduledAt: new Date(), durationMinutes: 30 }, 0)).rejects.toThrow(/Orçamento não encontrado/);
  });
});
