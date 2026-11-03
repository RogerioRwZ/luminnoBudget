import { router } from "./_core/trpc";
import { adminRouter } from "./routers/admin";
import { afterSalesRouter } from "./routers/afterSales";
import { loansRouter } from "./routers/loans";
import { pushRouter } from "./routers/push";
import { businessRouter } from "./routers/business";
import { localAuthRouter } from "./routers/localAuth";

export const appRouter = router({
  auth: localAuthRouter,
  admin: adminRouter,
  afterSales: afterSalesRouter,
  loans: loansRouter,
  push: pushRouter,
  ...businessRouter._def.record,
});

export type AppRouter = typeof appRouter;
