import "dotenv/config";
import express, { type Request, type Response } from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ensureUploadDirectory, registerLocalStorage } from "../localStorage";

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

// Middleware de segurança
function securityHeaders(req: Request, res: Response, next: Function) {
  // HSTS - Force HTTPS em produção
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  
  // Previne clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  
  // Previne MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  
  // XSS Protection (legacy, CSP é o novo padrão)
  res.setHeader("X-XSS-Protection", "1; mode=block");
  
  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';"
  );
  
  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Permissions Policy
  res.setHeader("Permissions-Policy", "microphone=(), camera=(), geolocation=(), payment=()");
  
  next();
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  // Configurações de segurança
  app.set("trust proxy", 1);
  app.set("x-powered-by", false); // Remove X-Powered-By header
  
  // Middleware de segurança
  app.use(securityHeaders);
  
  // Body parser com limite razoável
  app.use(express.json({ limit: "10mb" })); // Reduzido de 50mb para 10mb
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  
  await ensureUploadDirectory();
  registerLocalStorage(app);
  
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
