import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getVapidKeys, pushStatus, removePushSubscription, savePushSubscription, sendPushToUser } from "../pushDb";

const endpoint = z.string().url().max(2000).refine((value) => value.startsWith("https://"), "Endereço de aviso inválido");

// Avisos no celular: cada pessoa ativa nos próprios aparelhos.
export const pushRouter = router({
  publicKey: protectedProcedure.query(async () => (await getVapidKeys()).publicKey),
  status: protectedProcedure.input(z.object({ endpoint: endpoint.nullable().optional() })).query(({ ctx, input }) => pushStatus(ctx.user.id, input.endpoint)),
  subscribe: protectedProcedure.input(z.object({
    endpoint,
    p256dh: z.string().min(80).max(160),
    auth: z.string().min(16).max(64),
    userAgent: z.string().max(500).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    await savePushSubscription(ctx.user.id, input);
    return pushStatus(ctx.user.id, input.endpoint);
  }),
  unsubscribe: protectedProcedure.input(z.object({ endpoint })).mutation(async ({ ctx, input }) => {
    await removePushSubscription(ctx.user.id, input.endpoint);
    return { ok: true };
  }),
  test: protectedProcedure.mutation(({ ctx }) => sendPushToUser(ctx.user.id, { title: "Luminno", body: "Os avisos estão funcionando neste aparelho. ✅", url: "/", tag: "teste" })),
});
