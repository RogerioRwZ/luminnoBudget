import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { parse } from "cookie";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ensurePdfHistoryDirectory, ensureUploadDirectory, getLocalAttachmentPath, getLocalPdfPath, registerLocalStorage } from "../localStorage";
import { getAttachment } from "../advancedDb";
import { COOKIE_NAME } from "../../shared/const";
import { verifyLocalSession } from "../localAuth";
import { getActiveLocalUserById } from "../localUserDb";
import { getQuotePdfHistoryEntry } from "../quoteDb";

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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  await ensureUploadDirectory();
  await ensurePdfHistoryDirectory();
  registerLocalStorage(app);
  app.get("/api/quote-attachments/:attachmentId/download", async (req, res) => {
    const attachmentId = Number(req.params.attachmentId);
    const token = parse(req.headers.cookie ?? "")[COOKIE_NAME];
    const session = token ? await verifyLocalSession(token) : null;
    const user = session ? await getActiveLocalUserById(session.userId) : null;
    if (!user) return res.status(401).send("Autenticação necessária.");
    if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) return res.status(404).send("Anexo não encontrado.");
    const entry = await getAttachment(attachmentId);
    if (!entry) return res.status(404).send("Anexo não encontrado.");
    try { res.setHeader("Cache-Control", "private, no-store"); return res.download(getLocalAttachmentPath(entry.storageKey), entry.fileName); }
    catch { return res.status(404).send("Arquivo de anexo não encontrado."); }
  });
  app.get("/api/quote-pdfs/:historyId/download", async (req, res) => {
    const historyId = Number(req.params.historyId);
    const token = parse(req.headers.cookie ?? "")[COOKIE_NAME];
    const session = token ? await verifyLocalSession(token) : null;
    const user = session ? await getActiveLocalUserById(session.userId) : null;
    if (!user) return res.status(401).send("Autenticação necessária.");
    if (!Number.isSafeInteger(historyId) || historyId < 1) return res.status(404).send("PDF não encontrado.");
    const entry = await getQuotePdfHistoryEntry(historyId);
    if (!entry) return res.status(404).send("PDF não encontrado.");
    try {
      res.setHeader("Cache-Control", "private, no-store");
      return res.download(getLocalPdfPath(entry.storageKey), entry.fileName);
    } catch {
      return res.status(404).send("Arquivo PDF não encontrado.");
    }
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
}

startServer().catch(console.error);
