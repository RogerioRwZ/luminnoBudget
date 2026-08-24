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

// Rate limiting simples em memória (usar Redis em produção)
const loginAttempts = new Map<string, { count: number; resetTime: number }>();
const REQUEST_LIMIT_PER_MINUTE = 100;
const LOGIN_ATTEMPTS_LIMIT = 5;
const LOCKOUT_MINUTES = 15;

function getClientIp(req: CreateExpressContextOptions["req"]): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

export function recordLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  
  if (!attempt || attempt.resetTime < now) {
    // Nova janela de tempo
    loginAttempts.set(ip, { count: 1, resetTime: now + LOCKOUT_MINUTES * 60 * 1000 });
    return true; // Permitir
  }
  
  if (attempt.count >= LOGIN_ATTEMPTS_LIMIT) {
    return false; // Bloqueado
  }
  
  attempt.count++;
  return true; // Permitir
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  const cookies = parse(opts.req.headers.cookie ?? "");
  const token = cookies[COOKIE_NAME];
  
  if (token) {
    // Validar token
    const session = await verifyLocalSession(token);
    if (session) {
      // Verificar se usuário ainda está ativo
      user = await getActiveLocalUserById(session.userId);
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
