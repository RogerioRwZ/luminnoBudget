import { TRPCError } from "@trpc/server";
import { statfs } from "node:fs/promises";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getUploadDirectory } from "../localStorage";
import { readBackupStatus } from "../backupStatus";
import { recordActivity } from "../activityLog";
import { ROLE_LABELS, USER_ROLES } from "../../shared/permissions";
import { countActiveLocalAdmins, countLocalUsers, createLocalUser, getLocalUserForAdmin, listLocalUsers, resetLocalUserPassword, updateLocalUser, verifyDatabaseConnection } from "../localUserDb";

const optionalEmail = z.string().email().optional().or(z.literal(""));
const role = z.enum(USER_ROLES);

export const adminRouter = router({
  systemStatus: adminProcedure.query(async () => {
    const uploadDirectory = getUploadDirectory();
    let storage = null as null | { availableBytes: number; totalBytes: number };
    try {
      const stats = await statfs(uploadDirectory);
      storage = { availableBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
    } catch {
      storage = null;
    }
    return {
      application: "online" as const,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      databaseOnline: await verifyDatabaseConnection(),
      localUserCount: await countLocalUsers(),
      uploadDirectory,
      storage,
      backup: await readBackupStatus(),
      now: new Date(),
    };
  }),
  listUsers: adminProcedure.query(() => listLocalUsers()),
  createUser: adminProcedure
    .input(z.object({ username: z.string().trim().min(3).max(80), name: z.string().trim().min(2).max(240), email: optionalEmail, password: z.string().min(12).max(200), role }))
    .mutation(async ({ ctx, input }) => {
      try {
        const created = await createLocalUser({ ...input, email: input.email || null });
        await recordActivity(ctx.user, { action: "user.create", entityType: "user", entityId: created.id, summary: `Criou o usuário ${created.username} (${ROLE_LABELS[input.role]})` }, ctx.req);
        return created;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível criar o usuário." });
      }
    }),
  updateUser: adminProcedure
    .input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(2).max(240), email: optionalEmail, role, isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const target = await getLocalUserForAdmin(input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      if (input.id === ctx.user.id && (!input.isActive || input.role !== "admin")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode remover seu próprio acesso administrativo." });
      }
      const removesLastAdmin = target.role === "admin" && target.isActive && (!input.isActive || input.role !== "admin");
      if (removesLastAdmin && (await countActiveLocalAdmins()) <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Mantenha ao menos um administrador ativo." });
      }
      const updated = await updateLocalUser(input.id, { ...input, email: input.email || null });
      const notes = [
        target.role !== input.role ? `perfil ${ROLE_LABELS[target.role]} → ${ROLE_LABELS[input.role]}` : "",
        target.isActive !== input.isActive ? (input.isActive ? "reativado" : "desativado") : "",
      ].filter(Boolean);
      await recordActivity(ctx.user, { action: "user.update", entityType: "user", entityId: input.id, summary: `Atualizou o usuário ${target.username}${notes.length ? `: ${notes.join(", ")}` : ""}` }, ctx.req);
      return updated;
    }),
  resetPassword: adminProcedure
    .input(z.object({ id: z.number().int().positive(), password: z.string().min(12).max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await resetLocalUserPassword(input.id, input.password);
        const target = await getLocalUserForAdmin(input.id);
        await recordActivity(ctx.user, { action: "user.password_reset", entityType: "user", entityId: input.id, summary: `Redefiniu a senha do usuário ${target?.username ?? input.id}` }, ctx.req);
        return { success: true } as const;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível redefinir a senha." });
      }
    }),
});
