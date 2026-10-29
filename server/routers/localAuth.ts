import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "../../shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getSessionMaxAgeMs, signLocalSession, toSafeUser, verifyPassword, verifyPasswordOrDummy } from "../localAuth";
import { assertLoginAllowed, clearLoginFailures, registerLoginFailure } from "../loginRateLimit";
import {
  countLocalUsers,
  createInitialAdminUser,
  getActiveLocalUserById,
  getLocalUserByUsername,
  markLocalUserSignedIn,
  resetLocalUserPassword,
} from "../localUserDb";

const credentials = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(12).max(200),
});

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function setSessionCookie(ctx: { req: any; res: any }, token: string) {
  ctx.res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(ctx.req),
    maxAge: getSessionMaxAgeMs(),
  });
}

export const localAuthRouter = router({
  status: publicProcedure.query(async ({ ctx }) => ({
    setupRequired: (await countLocalUsers()) === 0,
    user: ctx.user ? toSafeUser(ctx.user) : null,
  })),
  setup: publicProcedure
    .input(credentials.extend({ name: z.string().trim().min(2).max(240), email: z.string().email().optional().or(z.literal("")) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const safeUser = await createInitialAdminUser({ ...input, email: input.email || null });
        const created = await getLocalUserByUsername(safeUser.username);
        if (!created) throw new Error("Não foi possível iniciar a sessão do administrador.");
        setSessionCookie(ctx, await signLocalSession(created));
        return safeUser;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: messageFrom(error, "Não foi possível criar o administrador.") });
      }
    }),
  login: publicProcedure.input(credentials).mutation(async ({ ctx, input }) => {
    const ip = ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";
    try {
      assertLoginAllowed(input.username, ip);
    } catch (error) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error instanceof Error ? error.message : "Muitas tentativas. Aguarde alguns minutos." });
    }
    const user = await getLocalUserByUsername(input.username);
    const passwordMatches = await verifyPasswordOrDummy(input.password, user?.passwordHash);
    if (!user || !user.isActive || !passwordMatches) {
      registerLoginFailure(input.username, ip);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Usuário ou senha inválidos." });
    }
    clearLoginFailures(input.username, ip);
    await markLocalUserSignedIn(user.id);
    setSessionCookie(ctx, await signLocalSession(user));
    return toSafeUser({ ...user, lastSignedIn: new Date() });
  }),
  me: publicProcedure.query(({ ctx }) => (ctx.user ? toSafeUser(ctx.user) : null)),
  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req));
    return { success: true } as const;
  }),
  changeOwnPassword: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(12).max(200), newPassword: z.string().min(12).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Mesmo limite do login: impede que uma sessão aberta (ex.: computador
      // esquecido desbloqueado) seja usada para adivinhar a senha atual.
      const ip = ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";
      const rateKey = `change-password:${ctx.user.id}`;
      try {
        assertLoginAllowed(rateKey, ip);
      } catch (error) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: messageFrom(error, "Muitas tentativas. Aguarde alguns minutos.") });
      }
      if (!(await verifyPassword(input.currentPassword, ctx.user.passwordHash))) {
        registerLoginFailure(rateKey, ip);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "A senha atual não confere." });
      }
      clearLoginFailures(rateKey, ip);
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A nova senha deve ser diferente da senha atual." });
      }
      try {
        await resetLocalUserPassword(ctx.user.id, input.newPassword);
        // A troca invalida todas as sessões anteriores; reemite o cookie
        // para que apenas esta sessão continue ativa.
        const refreshed = await getActiveLocalUserById(ctx.user.id);
        if (refreshed) setSessionCookie(ctx, await signLocalSession(refreshed));
        return { success: true } as const;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: messageFrom(error, "Não foi possível alterar a senha.") });
      }
    }),
});
