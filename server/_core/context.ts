import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { parse } from "cookie";
import { COOKIE_NAME } from "../../shared/const";
import { verifyLocalSession } from "../localAuth";
import { getActiveLocalUserById } from "../localUserDb";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  const cookies = parse(opts.req.headers.cookie ?? "");
  const token = cookies[COOKIE_NAME];
  if (token) {
    const session = await verifyLocalSession(token);
    if (session) user = await getActiveLocalUserById(session.userId);
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
