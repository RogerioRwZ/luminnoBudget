import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { NextFunction, Request, Response } from "express";
import { appRouter } from "../routers";
import { createContext, getRequestUser } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ensurePdfHistoryDirectory, ensureUploadDirectory, getLocalAttachmentPath, getLocalPdfPath, registerLocalStorage } from "../localStorage";
import { getAttachment } from "../advancedDb";
import { verifyDatabaseConnection } from "../localUserDb";
import { getQuotePdfHistoryEntry } from "../quoteDb";
import { startPushScheduler } from "../pushDb";
import { startStorageCleanup } from "../storageCleanup";
import { normalizeStoredContacts } from "../contactMigration";
import { canAccess } from "@shared/permissions";

function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // A câmera é usada pelo leitor de código de barras; o resto fica bloqueado.
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }
  next();
}

// De onde o navegador pode carregar cada coisa. Só em produção (o Vite de
// desenvolvimento injeta scripts próprios). Scripts só do sistema; WebAssembly
// para o leitor de código de barras; estilos inline (gráficos) e as fontes do
// Google; imagens e buscas HTTPS para fotos antigas guardadas fora daqui;
// blob: para a pré-visualização do PDF.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

// Envios grandes (fotos, anexos) só de quem está logado: sem isso, qualquer
// um poderia mandar 25 MB e o servidor leria tudo antes de recusar.
const ANONYMOUS_BODY_LIMIT = 1024 * 1024;
async function limitAnonymousBodies(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const declared = req.headers["content-length"];
  if (declared !== undefined && Number(declared) <= ANONYMOUS_BODY_LIMIT) return next();
  try {
    if (await getRequestUser(req)) return next();
  } catch {
    // Sem como conferir a sessão: trata como anônimo.
  }
  res.status(413).send("Envio grande demais. Entre no sistema para enviar arquivos.");
}

// res.download é assíncrono: um arquivo ausente no disco não cai em
// try/catch, e sem callback o erro vai para o handler padrão do Express
// (que em desenvolvimento devolve a pilha com o caminho absoluto).
function sendPrivateFile(res: Response, resolvePath: () => string, fileName: string, missingMessage: string) {
  let filePath: string;
  try {
    filePath = resolvePath();
  } catch {
    return res.status(404).send(missingMessage);
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.download(filePath, fileName, (error) => {
    if (error && !res.headersSent) res.status(404).send(missingMessage);
  });
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  // O maior envio legítimo é um anexo de 15 MB em base64 (~20 MB de JSON).
  app.use(limitAnonymousBodies);
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  await ensureUploadDirectory();
  await ensurePdfHistoryDirectory();
  registerLocalStorage(app);
  app.get("/api/health", async (_req, res) => {
    const databaseOnline = await verifyDatabaseConnection();
    res.setHeader("Cache-Control", "no-store");
    res.status(databaseOnline ? 200 : 503).json({ status: databaseOnline ? "ok" : "degraded", database: databaseOnline ? "online" : "offline", uptimeSeconds: Math.floor(process.uptime()) });
  });
  app.get("/api/quote-attachments/:attachmentId/download", async (req, res) => {
    const attachmentId = Number(req.params.attachmentId);
    const user = await getRequestUser(req);
    if (!user) return res.status(401).send("Autenticação necessária.");
    // Mesmo acesso da tela de anexos (Operação/Orçamentos).
    if (!canAccess(user.role, "quotes")) return res.status(403).send("Seu perfil não tem acesso aos anexos dos orçamentos.");
    if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) return res.status(404).send("Anexo não encontrado.");
    const entry = await getAttachment(attachmentId);
    if (!entry) return res.status(404).send("Anexo não encontrado.");
    sendPrivateFile(res, () => getLocalAttachmentPath(entry.storageKey), entry.fileName, "Arquivo de anexo não encontrado.");
  });
  app.get("/api/quote-pdfs/:historyId/download", async (req, res) => {
    const historyId = Number(req.params.historyId);
    const user = await getRequestUser(req);
    if (!user) return res.status(401).send("Autenticação necessária.");
    // Mesmo acesso do Histórico de PDFs.
    if (!canAccess(user.role, "quotes", "pdfs")) return res.status(403).send("Seu perfil não tem acesso ao histórico de PDFs.");
    if (!Number.isSafeInteger(historyId) || historyId < 1) return res.status(404).send("PDF não encontrado.");
    const entry = await getQuotePdfHistoryEntry(historyId);
    // PDFs novos não têm arquivo: são montados no navegador a partir dos dados.
    if (!entry?.storageKey) return res.status(404).send("PDF não encontrado.");
    const storageKey = entry.storageKey;
    sendPrivateFile(res, () => getLocalPdfPath(storageKey), entry.fileName, "Arquivo PDF não encontrado.");
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
  // Avisos no celular (Resumo do dia de manhã e alerta de backup).
  if (process.env.PUSH_DISABLED !== "1") startPushScheduler();
  if (process.env.STORAGE_CLEANUP_DISABLED !== "1") startStorageCleanup();
  // Uma vez: CPF/CNPJ, telefones e e-mails antigos no formato padrão.
  normalizeStoredContacts()
    .then((changed) => changed && console.log(`[contatos] ${changed} CPF/CNPJ, telefone(s) ou e-mail(s) reformatado(s) para o padrão.`))
    .catch((error) => console.warn("[contatos] reformatação não executada:", error instanceof Error ? error.message : error));
}

// Sai com código de erro se a inicialização falhar (ex.: pasta de uploads
// sem permissão): saindo com 0, o systemd (Restart=on-failure) entendia
// como parada normal e deixava o sistema fora do ar.
startServer().catch((error) => {
  console.error("Falha ao iniciar o servidor:", error);
  process.exit(1);
});
