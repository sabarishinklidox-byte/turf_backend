import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { corsOptions } from "./config/cors.js";
import { healthCheck } from "./controllers/health.controller.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { httpLogger } from "./middlewares/http-logger.middleware.js";
import { notFoundHandler } from "./middlewares/not-found.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import turfRoutes from "./routes/turf.routes.js";
import ownerRoutes from "./routes/owner.routes.js";
import adminOwnerRoutes from "./routes/admin-owner.routes.js";
import adminSettingsRoutes from "./routes/admin-settings.routes.js";
import adminTournamentRoutes from "./routes/admin-tournament.routes.js";
import adminBookingRoutes from "./routes/admin-booking.routes.js";
import adminUserRoutes from "./routes/admin-user.routes.js";
import adminReportRoutes from "./routes/admin-report.routes.js";
import userRoutes from "./routes/user.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(httpLogger);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(cors(corsOptions));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use("/api/v1/webhooks", express.raw({ type: "application/json", limit: "1mb" }), webhookRoutes);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/uploads", express.static("uploads"));
app.use("/media", express.static("storage"));

app.get("/api/v1/health", healthCheck);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin/turfs", turfRoutes);
app.use("/api/v1/admin/owners", adminOwnerRoutes);
app.use("/api/v1/admin/users", adminUserRoutes);
app.use("/api/v1/admin/bookings", adminBookingRoutes);
app.use("/api/v1/admin/reports", adminReportRoutes);
app.use("/api/v1/admin/settings", adminSettingsRoutes);
app.use("/api/v1/admin/tournaments", adminTournamentRoutes);
app.use("/api/v1/owner", ownerRoutes);
app.use("/api/v1/user", userRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
