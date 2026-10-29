import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { parse } from "cookie";
import { COOKIE_NAME } from "../../shared/const";
import { resolveSessionUser } from "../localAuth";
import { getActiveLocalUserById } from "../localUserDb";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function getRequestUser(req: { headers: { cookie?: string } }) {
  const token = parse(req.headers.cookie ?? "")[COOKIE_NAME];
  return resolveSessionUser(token, getActiveLocalUserById);
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  return {
    req: opts.req,
    res: opts.res,
    user: await getRequestUser(opts.req),
  };
}
