import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { canAccess, canSeeCost, type Area } from "@shared/permissions";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// Regra de negócio recusada (`throw new Error("...")` nos módulos do servidor)
// é erro de quem pediu, com mensagem para a pessoa. Falha de verdade (banco,
// bug) vira 500 com mensagem genérica: o texto original pode trazer SQL.
const friendlyErrors = t.middleware(async ({ next, path }) => {
  const result = await next();
  if (result.ok || result.error.code !== "INTERNAL_SERVER_ERROR") return result;
  const cause = result.error.cause as (Error & { code?: unknown; errno?: unknown }) | undefined;
  if (cause?.constructor === Error && cause.code === undefined && cause.errno === undefined) {
    return { ...result, error: new TRPCError({ code: "BAD_REQUEST", message: cause.message, cause }) };
  }
  console.error(`[API] ${path}:`, cause ?? result.error);
  return { ...result, error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro interno. Tente novamente em instantes.", cause }) };
});

const baseProcedure = t.procedure.use(friendlyErrors);
export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// Custo e margem nunca saem do servidor para quem não pode vê-los: os campos
// são retirados de qualquer resposta (produto, orçamento, listas...).
const COST_FIELDS = new Set(["costPrice", "unitCost"]);
export function stripCostFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => stripCostFields(entry)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !COST_FIELDS.has(key)).map(([key, entry]) => [key, stripCostFields(entry)])) as T;
  }
  return value;
}

const hideCost = t.middleware(async ({ ctx, next }) => {
  const result = await next();
  if (result.ok && !canSeeCost(ctx.user?.role)) return { ...result, data: stripCostFields(result.data) };
  return result;
});

export const protectedProcedure = baseProcedure.use(requireUser).use(hideCost);

export const adminProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// Acesso por área conforme o perfil do usuário (shared/permissions).
export const areaProcedure = (...areas: Area[]) =>
  protectedProcedure.use(
    t.middleware(async ({ ctx, next }) => {
      if (!canAccess(ctx.user?.role, ...areas)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Seu perfil não tem acesso a esta área. Fale com o administrador." });
      }
      return next();
    }),
  );
