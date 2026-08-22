import { router } from "./_core/trpc";
import { adminRouter } from "./routers/admin";
import { businessRouter } from "./routers/business";
import { localAuthRouter } from "./routers/localAuth";

export const appRouter = router({
  auth: localAuthRouter,
  admin: adminRouter,
  ...businessRouter._def.record,
});

export type AppRouter = typeof appRouter;
