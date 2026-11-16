import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import type { DB } from "./db/db.js";
import { csrfGuard, loadUser, requireAuth } from "./lib/auth.js";
import { config } from "./lib/config.js";
import { errorHandler, notFound } from "./lib/errors.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { customerRoutes } from "./routes/customers.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { documentRoutes } from "./routes/documents.js";
import { fileRoutes } from "./routes/files.js";
import { inspectionRoutes } from "./routes/inspections.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { jobRoutes } from "./routes/jobs.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { reportRoutes } from "./routes/reports.js";
import { timeRoutes } from "./routes/time.js";
import { timeOffRoutes } from "./routes/timeoff.js";
import { userRoutes } from "./routes/users.js";

export function createApp(db: DB) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback"); // correct client IPs behind a local reverse proxy
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(csrfGuard);
  api.use(loadUser(db));
  api.get("/health", (_req, res) => res.json({ ok: true }));
  api.use("/auth", authRoutes(db));

  // Everything below requires a signed-in user with a permanent password.
  api.use(requireAuth);
  api.use("/dashboard", dashboardRoutes(db));
  api.use("/users", userRoutes(db));
  api.use("/customers", customerRoutes(db));
  api.use("/jobs", jobRoutes(db));
  api.use("/time", timeRoutes(db));
  api.use("/time-off", timeOffRoutes(db));
  api.use("/inventory", inventoryRoutes(db));
  api.use("/maintenance", maintenanceRoutes(db));
  api.use("/documents", documentRoutes(db));
  api.use("/inspections", inspectionRoutes(db));
  api.use("/reports", reportRoutes(db));
  api.use("/admin", adminRoutes(db));
  api.use("/", fileRoutes(db));
  api.use(() => {
    throw notFound("API endpoint");
  });
  app.use("/api", api);

  // Serve the built web app (production). In development Vite serves it.
  const clientDir = path.resolve("dist/client");
  if (fs.existsSync(path.join(clientDir, "index.html"))) {
    app.use(express.static(clientDir, { index: false, maxAge: config.isProd ? "1h" : 0 }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
