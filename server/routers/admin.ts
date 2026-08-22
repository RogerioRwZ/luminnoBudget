import { TRPCError } from "@trpc/server";
import { statfs } from "node:fs/promises";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { countActiveLocalAdmins, countLocalUsers, createLocalUser, getLocalUserForAdmin, listLocalUsers, resetLocalUserPassword, updateLocalUser, verifyDatabaseConnection } from "../localUserDb";

const optionalEmail = z.string().email().optional().or(z.literal(""));
const role = z.enum(["user", "admin"]);

export const adminRouter = router({
  systemStatus: adminProcedure.query(async () => {
    const uploadDirectory = process.env.UPLOAD_DIR || "./uploads";
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
      now: new Date(),
    };
  }),
  listUsers: adminProcedure.query(() => listLocalUsers()),
  createUser: adminProcedure
    .input(z.object({ username: z.string().trim().min(3).max(80), name: z.string().trim().min(2).max(240), email: optionalEmail, password: z.string().min(12).max(200), role }))
    .mutation(async ({ input }) => {
      try {
        return await createLocalUser({ ...input, email: input.email || null });
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
      return updateLocalUser(input.id, { ...input, email: input.email || null });
    }),
  resetPassword: adminProcedure
    .input(z.object({ id: z.number().int().positive(), password: z.string().min(12).max(200) }))
    .mutation(async ({ input }) => {
      try {
        await resetLocalUserPassword(input.id, input.password);
        return { success: true } as const;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível redefinir a senha." });
      }
    }),
});
