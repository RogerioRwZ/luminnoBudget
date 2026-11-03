import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { appKeys, pushSubscriptions, users } from "../drizzle/schema";
import { needsBackupAttention } from "../shared/backupStatus";
import { dailySummaryCount, dailySummaryHeadline } from "../shared/dailySummary";
import { readBackupStatus } from "./backupStatus";
import { getDb } from "./db";
import { getSettings } from "./quoteDb";
import { dailySummary } from "./reportsDb";
import { encryptPayload, generateVapidKeys, vapidAuthorization, type VapidKeys } from "./webPushCrypto";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível. Tente novamente em instantes.");
  return db;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };
type Subscription = typeof pushSubscriptions.$inferSelect;

async function readKey(name: string) {
  const db = await database();
  return (await db.select().from(appKeys).where(eq(appKeys.name, name)).limit(1))[0]?.value ?? null;
}

async function writeKey(name: string, value: string) {
  const db = await database();
  await db.insert(appKeys).values({ name, value }).onDuplicateKeyUpdate({ set: { value } });
}

// Chaves VAPID: do ambiente, se definidas; senão, geradas na primeira vez e
// guardadas no banco (assim funciona sem configurar nada).
let cachedKeys: VapidKeys | null = null;
export async function getVapidKeys(): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_JWK) {
    cachedKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(process.env.VAPID_PRIVATE_JWK) };
    return cachedKeys;
  }
  const stored = await readKey("vapid");
  if (stored) return (cachedKeys = JSON.parse(stored) as VapidKeys);
  const db = await database();
  // Dois processos ao mesmo tempo: só a primeira gravação vale.
  await db.insert(appKeys).values({ name: "vapid", value: JSON.stringify(generateVapidKeys()) }).onDuplicateKeyUpdate({ set: { name: "vapid" } });
  cachedKeys = JSON.parse((await readKey("vapid"))!) as VapidKeys;
  return cachedKeys;
}

// "sub" do VAPID: os serviços de push usam para contato em caso de abuso.
async function vapidSubject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const email = (await getSettings()).email;
  return email ? `mailto:${email}` : "https://github.com/RogerioRwZ/luminnoBudget";
}

const hashEndpoint = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

export async function savePushSubscription(userId: number, input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }) {
  const db = await database();
  const values = { userId, endpointHash: hashEndpoint(input.endpoint), endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent?.slice(0, 255) || null };
  // O mesmo aparelho pode trocar de usuário: a inscrição passa para quem entrou.
  await db.insert(pushSubscriptions).values(values).onDuplicateKeyUpdate({ set: { userId, p256dh: values.p256dh, auth: values.auth, userAgent: values.userAgent } });
}

export async function removePushSubscription(userId: number, endpoint: string) {
  const db = await database();
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpointHash, hashEndpoint(endpoint)), eq(pushSubscriptions.userId, userId)));
}

export async function pushStatus(userId: number, endpoint?: string | null) {
  const db = await database();
  const rows = await db.select({ endpointHash: pushSubscriptions.endpointHash }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return { devices: rows.length, thisDevice: Boolean(endpoint) && rows.some((row) => row.endpointHash === hashEndpoint(endpoint!)) };
}

// O corpo cifrado cabe num registro de 4 KB; textos longos são cortados.
function encode(payload: PushPayload) {
  const fit = { ...payload, body: payload.body.slice(0, 900) };
  return Buffer.from(JSON.stringify(fit));
}

export async function sendPush(subscriptions: Subscription[], payload: PushPayload) {
  if (!subscriptions.length) return { sent: 0, removed: 0, failed: 0 };
  const [keys, subject] = await Promise.all([getVapidKeys(), vapidSubject()]);
  const db = await database();
  const result = { sent: 0, removed: 0, failed: 0 };
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          Authorization: vapidAuthorization(subscription.endpoint, subject, keys),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(12 * 60 * 60),
          Urgency: "normal",
        },
        body: encryptPayload(encode(payload), subscription.p256dh, subscription.auth),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404 || response.status === 410) {
        // O aparelho cancelou os avisos ou o navegador trocou a inscrição.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        result.removed += 1;
      } else if (response.ok) {
        result.sent += 1;
      } else {
        result.failed += 1;
        console.warn(`[avisos] serviço de push respondeu ${response.status} para a inscrição #${subscription.id}`);
      }
    } catch (error) {
      result.failed += 1;
      console.warn(`[avisos] falha ao enviar para a inscrição #${subscription.id}:`, error instanceof Error ? error.message : error);
    }
  }));
  return result;
}

export async function sendPushToUser(userId: number, payload: PushPayload) {
  const db = await database();
  return sendPush(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)), payload);
}

// Resumo do dia no celular, uma vez por dia a partir da hora configurada,
// só para quem tem pendências.
export async function runDailyPush(now = new Date()) {
  const hour = Number(process.env.PUSH_DAILY_HOUR ?? 8);
  if (now.getHours() < hour) return { users: 0 };
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const db = await database();
  const due = await db.select().from(pushSubscriptions).where(or(isNull(pushSubscriptions.lastDailyAt), lt(pushSubscriptions.lastDailyAt, startOfDay)));
  if (!due.length) return { users: 0 };
  const userIds = Array.from(new Set(due.map((row) => row.userId)));
  const userRows = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(inArray(users.id, userIds));
  // Usuário excluído: a inscrição dele não serve mais.
  const orphans = due.filter((row) => !userRows.some((user) => user.id === row.userId));
  if (orphans.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, orphans.map((row) => row.id)));
  let notified = 0;
  for (const user of userRows) {
    const mine = due.filter((row) => row.userId === user.id);
    if (user.isActive) {
      const summary = await dailySummary(user.role, now);
      const count = dailySummaryCount(summary);
      if (count > 0) {
        await sendPush(mine, { title: `Resumo do dia: ${count} ${count === 1 ? "pendência" : "pendências"}`, body: dailySummaryHeadline(summary), url: "/?resumo=1", tag: "resumo-do-dia" });
        notified += 1;
      }
    }
    await db.update(pushSubscriptions).set({ lastDailyAt: now }).where(inArray(pushSubscriptions.id, mine.map((row) => row.id)));
  }
  return { users: notified };
}

// Backup atrasado ou com falha: avisa os administradores uma vez por ocorrência.
export async function runBackupAlert(now = new Date()) {
  const status = await readBackupStatus(now);
  if (!needsBackupAttention(status.state)) return false;
  const key = status.state === "failed" ? `failed:${status.lastFailureAt?.toISOString()}` : `stale:${status.lastSuccessAt?.toISOString()}`;
  if ((await readKey("push.backupAlert")) === key) return false;
  const db = await database();
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  const subscriptions = admins.length ? await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, admins.map((admin) => admin.id))) : [];
  await sendPush(subscriptions, {
    title: status.state === "failed" ? "O backup do Luminno falhou" : "Backup do Luminno atrasado",
    body: status.state === "failed" ? status.error || "Veja a situação em Administração." : "Mais de 36 horas sem backup completo. Veja a situação em Administração.",
    url: "/administracao",
    tag: "backup",
  });
  await writeKey("push.backupAlert", key);
  return true;
}

// Verifica a cada 10 minutos. Falhas só vão para o log: os avisos nunca
// podem derrubar o sistema.
export function startPushScheduler() {
  const tick = async () => {
    try {
      await runDailyPush();
      await runBackupAlert();
    } catch (error) {
      console.warn("[avisos] verificação falhou:", error instanceof Error ? error.message : error);
    }
  };
  const timer = setInterval(tick, 10 * 60_000);
  timer.unref();
  setTimeout(tick, 60_000).unref();
  return timer;
}
